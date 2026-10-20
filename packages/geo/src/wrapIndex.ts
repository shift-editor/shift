/**
 * Maps any integer index onto `0..length-1`, wrapping in both directions.
 *
 * @param index - Any integer, including negative or past-the-end values.
 * @param length - The cycle length; must be positive.
 * @returns `index` modulo `length`, never negative: `wrapIndex(-1, 4)` is `3`.
 */
export function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}
