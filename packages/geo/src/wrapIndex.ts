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

/**
 * Returns the item at `index`, wrapping around the ends when `wrap` is set.
 *
 * @remarks
 * For sequences that are cyclic only sometimes, such as a contour's points,
 * which wrap when the contour is closed.
 *
 * @returns null for an empty list, or for an index outside it when `wrap` is off.
 */
export function cyclicAt<T>(items: readonly T[], index: number, wrap: boolean): T | null {
  if (index >= 0 && index < items.length) return items[index]!;
  if (!wrap || items.length === 0) return null;

  return items[wrapIndex(index, items.length)]!;
}
