/**
 * Formats a number with bounded decimal precision and normalized zero.
 *
 * @param value - Finite numeric value to serialize.
 * @param maximumFractionDigits - Greatest number of digits retained after the decimal point.
 * @returns A compact decimal representation with negative zero written as `0`.
 */
export function formatDecimal(value: number, maximumFractionDigits = 6): string {
  const scale = 10 ** maximumFractionDigits;
  const rounded = Math.round(value * scale) / scale;
  return Object.is(rounded, -0) ? "0" : `${rounded}`;
}
