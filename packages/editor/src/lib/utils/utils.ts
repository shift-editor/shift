/** Constrain `value` to the inclusive range [`min`, `max`]. */
export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

/** Returns a fresh array with duplicate items removed while preserving order. */
export function uniqueInOrder<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}
