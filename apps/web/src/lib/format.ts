/**
 * Display formatting. Indian numbering conventions throughout — an applicant
 * reading "₹12,50,000" should not have to translate from "₹1,250,000".
 */

export function formatInr(amount: number, { decimals = 0 } = {}): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Compact rupee figures in the lakh/crore scale Indian businesses actually
 * speak in: ₹50L rather than ₹5,000,000.
 */
export function formatInrCompact(amount: number): string {
  if (amount >= 10_000_000) {
    const crore = amount / 10_000_000;
    return `₹${trimZeroes(crore)} Cr`;
  }
  if (amount >= 100_000) {
    const lakh = amount / 100_000;
    return `₹${trimZeroes(lakh)} L`;
  }
  if (amount >= 1_000) {
    return `₹${trimZeroes(amount / 1_000)}k`;
  }
  return formatInr(amount);
}

/** 2.50 -> "2.5", 3.00 -> "3" */
const trimZeroes = (value: number): string =>
  value.toFixed(2).replace(/\.?0+$/, '');

export const formatPct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

export function formatMonths(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = months / 12;
  if (Number.isInteger(years)) return `${years} year${years === 1 ? '' : 's'}`;
  return `${months} months`;
}
