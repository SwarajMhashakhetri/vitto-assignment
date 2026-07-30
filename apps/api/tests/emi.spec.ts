import { describe, expect, it } from 'vitest';
import { calculateEmi, calculateTotalRepayable } from '../src/engine/emi';

describe('calculateEmi', () => {
  /**
   * Reference values computed with the standard reducing-balance formula and
   * cross-checked against a public EMI calculator. Tolerance is ₹1 to absorb
   * floating-point differences, not to paper over a wrong formula.
   */
  const cases = [
    { principal: 1_000_000, ratePct: 18, months: 24, expected: 49_924.1 },
    { principal: 500_000, ratePct: 18, months: 12, expected: 45_840 },
    { principal: 100_000, ratePct: 18, months: 36, expected: 3_615.24 },
    { principal: 2_500_000, ratePct: 18, months: 60, expected: 63_483.57 },
  ];

  it.each(cases)(
    'computes ₹$principal over $months months at $ratePct% as ~₹$expected',
    ({ principal, ratePct, months, expected }) => {
      expect(calculateEmi(principal, ratePct, months)).toBeCloseTo(expected, 0);
    },
  );

  it('splits the principal evenly when the rate is zero', () => {
    expect(calculateEmi(120_000, 0, 12)).toBe(10_000);
  });

  it('returns the full principal when the tenure is a single month', () => {
    // One instalment at 18% p.a. is principal plus one month of interest.
    expect(calculateEmi(100_000, 18, 1)).toBeCloseTo(101_500, 0);
  });

  it('produces a larger instalment for a shorter tenure', () => {
    const short = calculateEmi(1_000_000, 18, 6);
    const long = calculateEmi(1_000_000, 18, 60);
    expect(short).toBeGreaterThan(long);
  });

  it('rounds to whole paise', () => {
    const emi = calculateEmi(333_333, 18, 7);
    expect(emi).toBe(Math.round(emi * 100) / 100);
  });

  it.each([
    { principal: 0, months: 12, label: 'zero principal' },
    { principal: -5_000, months: 12, label: 'negative principal' },
  ])('rejects $label', ({ principal, months }) => {
    expect(() => calculateEmi(principal, 18, months)).toThrow(RangeError);
  });

  it.each([
    { months: 0, label: 'zero tenure' },
    { months: -6, label: 'negative tenure' },
  ])('rejects $label', ({ months }) => {
    expect(() => calculateEmi(100_000, 18, months)).toThrow(RangeError);
  });
});

describe('calculateTotalRepayable', () => {
  it('multiplies the instalment by the tenure', () => {
    expect(calculateTotalRepayable(49_924.1, 24)).toBeCloseTo(1_198_178.4, 2);
  });

  it('always exceeds the principal when interest is charged', () => {
    const principal = 1_000_000;
    const emi = calculateEmi(principal, 18, 24);
    expect(calculateTotalRepayable(emi, 24)).toBeGreaterThan(principal);
  });
});
