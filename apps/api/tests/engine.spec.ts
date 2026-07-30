import { describe, expect, it } from 'vitest';
import {
  APPROVAL_THRESHOLD,
  SCORE_RANGE,
  deriveMetrics,
  evaluate,
  findMaxApprovableAmount,
} from '../src/engine';
import { calculateEmi } from '@lds/shared';
import { ANNUAL_INTEREST_RATE_PCT, ENGINE_VERSION } from '../src/config/scoring';
import type { EvaluationInput } from '../src/engine/types';
import type { ReasonCode } from '@lds/shared';

/**
 * A deliberately unremarkable application, used as the base for single-factor
 * tests. PAN surname initial 'S' matches "Sharma" so the consistency factor
 * stays neutral and does not contaminate other assertions.
 */
const baseInput: EvaluationInput = {
  ownerName: 'Rajesh Sharma',
  pan: 'ABCPS1234F',
  businessType: 'MANUFACTURING', // 0 sector points — the neutral choice
  monthlyRevenue: 500_000,
  requestedAmount: 1_000_000,
  tenureMonths: 24,
  purpose: 'WORKING_CAPITAL',
};

const withInput = (overrides: Partial<EvaluationInput>): EvaluationInput => ({
  ...baseInput,
  ...overrides,
});

const codesOf = (result: ReturnType<typeof evaluate>): ReasonCode[] =>
  result.reasons.map((r) => r.code);

/**
 * Builds an application whose EMI-to-revenue ratio is exactly `ratio`, by
 * solving for the revenue that produces it. Lets the band boundaries be
 * tested precisely instead of approximately.
 */
function inputWithEmiRatio(ratio: number, overrides: Partial<EvaluationInput> = {}) {
  const merged = withInput(overrides);
  const emi = calculateEmi(merged.requestedAmount, ANNUAL_INTEREST_RATE_PCT, merged.tenureMonths);
  return withInput({ ...overrides, monthlyRevenue: emi / ratio });
}

describe('evaluate — contract', () => {
  it('is deterministic: the same input always yields the same decision', () => {
    const first = evaluate(baseInput);
    const second = evaluate(baseInput);
    expect(second).toEqual(first);
  });

  it('does not mutate its input', () => {
    const input = withInput({});
    const snapshot = structuredClone(input);
    evaluate(input);
    expect(input).toEqual(snapshot);
  });

  it('stamps the engine version on every decision', () => {
    expect(evaluate(baseInput).engineVersion).toBe(ENGINE_VERSION);
  });

  it('always returns a score inside the published range', () => {
    const extremes = [
      withInput({ monthlyRevenue: 50_000_000, requestedAmount: 10_000, tenureMonths: 24 }),
      withInput({ monthlyRevenue: 30_000, requestedAmount: 900_000, tenureMonths: 3 }),
      baseInput,
    ];

    for (const input of extremes) {
      const { creditScore } = evaluate(input);
      expect(creditScore).toBeGreaterThanOrEqual(SCORE_RANGE.MIN);
      expect(creditScore).toBeLessThanOrEqual(SCORE_RANGE.MAX);
    }
  });

  it('always returns at least one reason code', () => {
    for (const input of [baseInput, withInput({ requestedAmount: 90_000_000 })]) {
      expect(evaluate(input).reasons.length).toBeGreaterThan(0);
    }
  });

  it('clamps an exceptionally strong application to the maximum score', () => {
    // Tiny loan against large revenue, ideal tenure, services sector: the raw
    // total exceeds 900 and must be capped rather than overflow.
    const result = evaluate(
      withInput({
        monthlyRevenue: 5_000_000,
        requestedAmount: 100_000,
        tenureMonths: 24,
        businessType: 'SERVICES',
      }),
    );
    expect(result.creditScore).toBe(SCORE_RANGE.MAX);
    expect(result.outcome).toBe('APPROVED');
  });
});

describe('hard rules — reject regardless of every other signal', () => {
  it('rejects a loan above 36x monthly revenue as inconsistent data', () => {
    // The brief's own example: ₹10L monthly revenue, ₹5Cr requested (50x).
    const result = evaluate(
      withInput({ monthlyRevenue: 1_000_000, requestedAmount: 50_000_000, tenureMonths: 36 }),
    );

    expect(result.outcome).toBe('REJECTED');
    expect(result.creditScore).toBe(SCORE_RANGE.MIN);
    expect(codesOf(result)).toContain('DATA_INCONSISTENCY');
  });

  it('rejects when the instalment meets or exceeds all revenue', () => {
    const result = evaluate(
      withInput({ monthlyRevenue: 40_000, requestedAmount: 900_000, tenureMonths: 24 }),
    );

    expect(result.outcome).toBe('REJECTED');
    expect(codesOf(result)).toContain('UNSERVICEABLE_EMI');
  });

  it('rejects revenue below the ₹25,000 lending floor', () => {
    const result = evaluate(withInput({ monthlyRevenue: 20_000, requestedAmount: 50_000 }));

    expect(result.outcome).toBe('REJECTED');
    expect(codesOf(result)).toContain('LOW_REVENUE');
  });

  it('reports every hard rule that fired, not just the first', () => {
    // 50x revenue AND an unserviceable instalment.
    const result = evaluate(
      withInput({ monthlyRevenue: 1_000_000, requestedAmount: 50_000_000, tenureMonths: 36 }),
    );

    expect(codesOf(result)).toEqual(
      expect.arrayContaining(['DATA_INCONSISTENCY', 'UNSERVICEABLE_EMI']),
    );
  });

  it('suppresses the score breakdown, because no score was computed', () => {
    const result = evaluate(withInput({ monthlyRevenue: 20_000, requestedAmount: 50_000 }));
    expect(result.scoreBreakdown).toEqual([]);
  });

  it('cannot be outvoted by an otherwise perfect application', () => {
    // Ideal tenure, best sector — but revenue is below the floor.
    const result = evaluate(
      withInput({
        monthlyRevenue: 24_999,
        requestedAmount: 10_000,
        tenureMonths: 24,
        businessType: 'SERVICES',
      }),
    );
    expect(result.outcome).toBe('REJECTED');
  });

  it('admits an application exactly at the 36x boundary to normal scoring', () => {
    const result = evaluate(
      withInput({ monthlyRevenue: 1_000_000, requestedAmount: 36_000_000, tenureMonths: 36 }),
    );
    // 36x is not > 36x, so DATA_INCONSISTENCY must not fire. The application
    // is still declined, but on the scorecard rather than the hard rule.
    expect(codesOf(result)).not.toContain('DATA_INCONSISTENCY');
  });
});

describe('factor 1 — EMI to revenue band boundaries', () => {
  /**
   * Each band is probed at its upper edge and just past it. Bands are
   * inclusive of their upper bound (`ratio <= maxRatio`), so 0.30 scores in
   * the 20–30% band and 0.3001 drops to the next one down.
   */
  const boundaries = [
    { ratio: 0.1, expectedPoints: 150, label: '10% exactly' },
    { ratio: 0.1001, expectedPoints: 100, label: 'just above 10%' },
    { ratio: 0.2, expectedPoints: 100, label: '20% exactly' },
    { ratio: 0.2001, expectedPoints: 40, label: 'just above 20%' },
    { ratio: 0.3, expectedPoints: 40, label: '30% exactly' },
    { ratio: 0.3001, expectedPoints: -40, label: 'just above 30%' },
    { ratio: 0.4, expectedPoints: -40, label: '40% exactly' },
    { ratio: 0.4001, expectedPoints: -120, label: 'just above 40%' },
    { ratio: 0.5, expectedPoints: -120, label: '50% exactly' },
    { ratio: 0.5001, expectedPoints: -220, label: 'just above 50%' },
  ];

  it.each(boundaries)('scores $label as $expectedPoints points', ({ ratio, expectedPoints }) => {
    const result = evaluate(inputWithEmiRatio(ratio));
    const factor = result.scoreBreakdown.find((f) => f.factor === 'EMI to revenue');
    expect(factor?.points).toBe(expectedPoints);
  });

  it('attaches STRONG_REVENUE_COVERAGE at or below 10%', () => {
    expect(codesOf(evaluate(inputWithEmiRatio(0.1)))).toContain('STRONG_REVENUE_COVERAGE');
  });

  it('attaches HIGH_EMI_BURDEN above 30%', () => {
    expect(codesOf(evaluate(inputWithEmiRatio(0.35)))).toContain('HIGH_EMI_BURDEN');
  });

  it('attaches neither code in the neutral 10–30% range', () => {
    const codes = codesOf(evaluate(inputWithEmiRatio(0.25)));
    expect(codes).not.toContain('STRONG_REVENUE_COVERAGE');
    expect(codes).not.toContain('HIGH_EMI_BURDEN');
  });
});

describe('factor 2 — loan to revenue multiple', () => {
  const boundaries = [
    { multiple: 3, expectedPoints: 90 },
    { multiple: 3.5, expectedPoints: 50 },
    { multiple: 6, expectedPoints: 50 },
    { multiple: 8, expectedPoints: 0 },
    { multiple: 12, expectedPoints: 0 },
    { multiple: 18, expectedPoints: -80 },
    { multiple: 24, expectedPoints: -80 },
    { multiple: 30, expectedPoints: -200 },
  ];

  it.each(boundaries)('scores $multiple x revenue as $expectedPoints', ({ multiple, expectedPoints }) => {
    const monthlyRevenue = 1_000_000;
    const result = evaluate(
      withInput({ monthlyRevenue, requestedAmount: monthlyRevenue * multiple, tenureMonths: 60 }),
    );
    const factor = result.scoreBreakdown.find((f) => f.factor === 'Loan to revenue multiple');
    expect(factor?.points).toBe(expectedPoints);
  });

  it('attaches COMFORTABLE_LOAN_RATIO at or below 3x', () => {
    const result = evaluate(withInput({ monthlyRevenue: 1_000_000, requestedAmount: 3_000_000 }));
    expect(codesOf(result)).toContain('COMFORTABLE_LOAN_RATIO');
  });

  it('attaches HIGH_LOAN_RATIO above 12x', () => {
    const result = evaluate(
      withInput({ monthlyRevenue: 1_000_000, requestedAmount: 15_000_000, tenureMonths: 60 }),
    );
    expect(codesOf(result)).toContain('HIGH_LOAN_RATIO');
  });
});

describe('factor 3 — tenure fit is non-monotonic', () => {
  const cases = [
    { tenureMonths: 3, expectedPoints: -60, code: 'SHORT_TENURE_RISK' },
    { tenureMonths: 5, expectedPoints: -60, code: 'SHORT_TENURE_RISK' },
    { tenureMonths: 6, expectedPoints: 10, code: null },
    { tenureMonths: 11, expectedPoints: 10, code: null },
    { tenureMonths: 12, expectedPoints: 60, code: 'HEALTHY_TENURE_FIT' },
    { tenureMonths: 36, expectedPoints: 60, code: 'HEALTHY_TENURE_FIT' },
    { tenureMonths: 37, expectedPoints: 10, code: null },
    { tenureMonths: 48, expectedPoints: 10, code: null },
    { tenureMonths: 49, expectedPoints: -70, code: 'LONG_TENURE_RISK' },
    { tenureMonths: 84, expectedPoints: -70, code: 'LONG_TENURE_RISK' },
  ] as const;

  it.each(cases)('scores $tenureMonths months as $expectedPoints', ({ tenureMonths, expectedPoints, code }) => {
    // Revenue kept high so tenure is the only factor being probed and no hard
    // rule can fire at the short end.
    const result = evaluate(withInput({ monthlyRevenue: 10_000_000, tenureMonths }));
    const factor = result.scoreBreakdown.find((f) => f.factor === 'Tenure fit');

    expect(factor?.points).toBe(expectedPoints);
    if (code) expect(codesOf(result)).toContain(code);
  });

  it('penalises both extremes relative to the ideal band', () => {
    const score = (tenureMonths: number) =>
      evaluate(withInput({ monthlyRevenue: 10_000_000, tenureMonths })).creditScore;

    expect(score(24)).toBeGreaterThan(score(3));
    expect(score(24)).toBeGreaterThan(score(72));
  });
});

describe('factor 4 — revenue scale', () => {
  const cases = [
    { monthlyRevenue: 2_000_000, expectedPoints: 80 },
    { monthlyRevenue: 1_000_000, expectedPoints: 80 },
    { monthlyRevenue: 999_999, expectedPoints: 50 },
    { monthlyRevenue: 500_000, expectedPoints: 50 },
    { monthlyRevenue: 100_000, expectedPoints: 20 },
    { monthlyRevenue: 50_000, expectedPoints: 0 },
    { monthlyRevenue: 40_000, expectedPoints: -100 },
  ];

  it.each(cases)('scores ₹$monthlyRevenue as $expectedPoints', ({ monthlyRevenue, expectedPoints }) => {
    // Loan sized to stay clear of the hard rules at every revenue level.
    const result = evaluate(withInput({ monthlyRevenue, requestedAmount: monthlyRevenue * 2 }));
    const factor = result.scoreBreakdown.find((f) => f.factor === 'Revenue scale');
    expect(factor?.points).toBe(expectedPoints);
  });
});

describe('factor 5 — sector adjustment stays small by design', () => {
  it.each([
    { businessType: 'SERVICES', expectedPoints: 20 },
    { businessType: 'RETAIL', expectedPoints: 10 },
    { businessType: 'MANUFACTURING', expectedPoints: 0 },
  ] as const)('applies $expectedPoints for $businessType', ({ businessType, expectedPoints }) => {
    const result = evaluate(withInput({ businessType }));
    const factor = result.scoreBreakdown.find((f) => f.factor === 'Sector adjustment');
    expect(factor?.points).toBe(expectedPoints);
  });

  it('cannot flip a decision on its own', () => {
    // Two applications identical but for sector: the 20-point spread must
    // never be enough to cross a threshold that the other factors did not.
    const spread =
      evaluate(withInput({ businessType: 'SERVICES' })).creditScore -
      evaluate(withInput({ businessType: 'MANUFACTURING' })).creditScore;

    expect(Math.abs(spread)).toBeLessThanOrEqual(20);
  });
});

describe('factor 6 — PAN / name consistency', () => {
  it('flags an individual PAN whose surname initial disagrees with the name', () => {
    // PAN says surname starts with 'K'; the application says "Sharma".
    const result = evaluate(withInput({ pan: 'ABCPK1234F', ownerName: 'Rajesh Sharma' }));
    expect(codesOf(result)).toContain('PAN_NAME_MISMATCH');
  });

  it('stays silent when the initials agree', () => {
    const result = evaluate(withInput({ pan: 'ABCPS1234F', ownerName: 'Rajesh Sharma' }));
    expect(codesOf(result)).not.toContain('PAN_NAME_MISMATCH');
  });

  it('skips the check for company PANs, where the 5th character is not a surname', () => {
    const result = evaluate(withInput({ pan: 'ABCCK1234F', ownerName: 'Rajesh Sharma' }));
    expect(codesOf(result)).not.toContain('PAN_NAME_MISMATCH');
  });

  it('skips the check for a mononym rather than guessing a surname', () => {
    const result = evaluate(withInput({ pan: 'ABCPK1234F', ownerName: 'Rajesh' }));
    expect(codesOf(result)).not.toContain('PAN_NAME_MISMATCH');
  });

  it('is a warning, not a blocker — a strong application still passes', () => {
    const result = evaluate(
      withInput({
        pan: 'ABCPK1234F',
        ownerName: 'Rajesh Sharma',
        monthlyRevenue: 5_000_000,
        requestedAmount: 1_000_000,
        tenureMonths: 24,
      }),
    );
    expect(codesOf(result)).toContain('PAN_NAME_MISMATCH');
    expect(result.outcome).toBe('APPROVED');
  });
});

describe('reference scenarios from the README', () => {
  it('approves a healthy application', () => {
    const result = evaluate({
      ownerName: 'Priya Nair',
      pan: 'ABCPN1234F',
      businessType: 'SERVICES',
      monthlyRevenue: 800_000,
      requestedAmount: 1_000_000,
      tenureMonths: 24,
      purpose: 'BUSINESS_EXPANSION',
    });

    expect(result.outcome).toBe('APPROVED');
    expect(result.creditScore).toBeGreaterThanOrEqual(APPROVAL_THRESHOLD);
    expect(codesOf(result)).toContain('STRONG_REVENUE_COVERAGE');
  });

  it('declines an over-leveraged application on affordability', () => {
    const result = evaluate({
      ownerName: 'Amit Kumar',
      pan: 'ABCPK1234F',
      businessType: 'RETAIL',
      monthlyRevenue: 100_000,
      requestedAmount: 500_000,
      tenureMonths: 12,
      purpose: 'INVENTORY_PURCHASE',
    });

    expect(result.outcome).toBe('REJECTED');
    expect(codesOf(result)).toContain('HIGH_EMI_BURDEN');
    expect(codesOf(result)).toContain('SCORE_BELOW_THRESHOLD');
  });

  it('declines the brief’s conflicting-data example', () => {
    const result = evaluate({
      ownerName: 'Sunita Devi',
      pan: 'ABCPD1234F',
      businessType: 'MANUFACTURING',
      monthlyRevenue: 1_000_000,
      requestedAmount: 50_000_000,
      tenureMonths: 36,
      purpose: 'BUSINESS_EXPANSION',
    });

    expect(result.outcome).toBe('REJECTED');
    expect(result.creditScore).toBe(SCORE_RANGE.MIN);
    expect(codesOf(result)).toContain('DATA_INCONSISTENCY');
  });
});

describe('reason ordering', () => {
  it('leads with critical reasons, then by magnitude of impact', () => {
    const result = evaluate(
      withInput({ monthlyRevenue: 100_000, requestedAmount: 1_200_000, tenureMonths: 60 }),
    );

    const severities = result.reasons.map((r) => r.severity);
    const firstNonCritical = severities.findIndex((s) => s !== 'CRITICAL');
    if (firstNonCritical !== -1) {
      expect(severities.slice(firstNonCritical)).not.toContain('CRITICAL');
    }
  });

  it('puts SCORE_BELOW_THRESHOLD first on a scorecard decline', () => {
    const result = evaluate(
      withInput({ monthlyRevenue: 100_000, requestedAmount: 1_200_000, tenureMonths: 60 }),
    );
    expect(result.outcome).toBe('REJECTED');
    expect(result.reasons[0]?.code).toBe('SCORE_BELOW_THRESHOLD');
  });
});

describe('deriveMetrics', () => {
  it('exposes the same EMI the engine scores against', () => {
    const metrics = deriveMetrics({
      requestedAmount: 1_000_000,
      tenureMonths: 24,
      monthlyRevenue: 800_000,
    });

    expect(metrics.estimatedEmi).toBeCloseTo(49_924.1, 1);
    expect(metrics.emiToRevenueRatio).toBeCloseTo(0.0624, 4);
    expect(metrics.loanToRevenueMultiple).toBeCloseTo(1.25, 4);
    expect(metrics.annualInterestRatePct).toBe(ANNUAL_INTEREST_RATE_PCT);
  });

  it('reports a total repayable above the principal', () => {
    const metrics = deriveMetrics({
      requestedAmount: 1_000_000,
      tenureMonths: 24,
      monthlyRevenue: 800_000,
    });
    expect(metrics.totalRepayable).toBeGreaterThan(1_000_000);
  });
});

describe('findMaxApprovableAmount', () => {
  it('suggests a smaller amount that would have been approved', () => {
    const input = withInput({
      monthlyRevenue: 500_000,
      requestedAmount: 5_000_000,
      tenureMonths: 24,
    });

    expect(evaluate(input).outcome).toBe('REJECTED');

    const maxAmount = findMaxApprovableAmount(input);
    expect(maxAmount).not.toBeNull();
    expect(maxAmount!).toBeLessThan(input.requestedAmount);
    expect(evaluate({ ...input, requestedAmount: maxAmount! }).outcome).toBe('APPROVED');
  });

  it('returns the requested amount unchanged when it is already approvable', () => {
    const input = withInput({
      monthlyRevenue: 5_000_000,
      requestedAmount: 1_000_000,
      tenureMonths: 24,
    });
    expect(findMaxApprovableAmount(input)).toBe(input.requestedAmount);
  });

  it('returns null when no amount would be approved', () => {
    // Revenue below the hard floor: nothing is lendable at any size.
    const input = withInput({ monthlyRevenue: 20_000, requestedAmount: 500_000 });
    expect(findMaxApprovableAmount(input)).toBeNull();
  });
});
