/**
 * Serialisation helpers for the boundary between database rows and JSON.
 */

/**
 * Drizzle returns NUMERIC columns as strings, deliberately: parsing them into
 * JS floats at the driver level would silently lose precision on large values.
 * The conversion happens here, at the point where a row becomes a JSON
 * response, so it is one decision in one place.
 *
 * Safe for this system because input validation caps every amount at ₹100
 * crore, far inside the 2^53 range where a double represents integers exactly.
 * The production answer is to store minor units (paise) as BIGINT and format
 * at the edge; that is listed as a known simplification in the README.
 */
export const numericToNumber = (value: string): number => Number(value);

/** Money going *into* a NUMERIC column, fixed to paise. */
export const numberToNumeric = (value: number): string => value.toFixed(2);

/** ISO 8601 strings, so clients parse dates the same way everywhere. */
export const toIsoString = (date: Date): string => date.toISOString();
