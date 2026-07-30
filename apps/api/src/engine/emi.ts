/**
 * Loan amortisation maths. Pure, dependency-free, and separated from the
 * scorecard so it can be tested against any standard EMI calculator.
 */

/** Round to paise. Avoids 4999.999999999999 leaking into responses. */
const roundToPaise = (value: number): number => Math.round(value * 100) / 100;

/**
 * Equated monthly instalment on a reducing-balance loan.
 *
 *   EMI = P · i · (1 + i)^n / ((1 + i)^n − 1)
 *
 * where `i` is the monthly rate and `n` the number of instalments. This is the
 * standard reducing-balance formula, not flat-rate interest — flat rate would
 * understate the true cost by roughly a factor of two at these tenures.
 *
 * @param principal            Loan amount in rupees.
 * @param annualRatePct        Nominal annual rate, e.g. 18 for 18% p.a.
 * @param tenureMonths         Number of monthly instalments.
 */
export function calculateEmi(
  principal: number,
  annualRatePct: number,
  tenureMonths: number,
): number {
  if (tenureMonths <= 0) {
    throw new RangeError('tenureMonths must be greater than zero');
  }
  if (principal <= 0) {
    throw new RangeError('principal must be greater than zero');
  }

  const monthlyRate = annualRatePct / 12 / 100;

  // A zero-interest loan is just the principal split evenly. The general
  // formula divides by zero here, so it is handled separately.
  if (monthlyRate === 0) {
    return roundToPaise(principal / tenureMonths);
  }

  const growth = Math.pow(1 + monthlyRate, tenureMonths);
  const emi = (principal * monthlyRate * growth) / (growth - 1);

  return roundToPaise(emi);
}

/** Total amount repaid across the full tenure, principal plus interest. */
export function calculateTotalRepayable(emi: number, tenureMonths: number): number {
  return roundToPaise(emi * tenureMonths);
}
