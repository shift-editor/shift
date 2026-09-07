import type { SequenceDiff } from "@/types";

/**
 * Returns the smallest single-splice difference between two ordered sequences.
 *
 * @param before - Sequence before the change.
 * @param after - Sequence after the change.
 * @returns A reversible changed range, or null when both sequences are equal.
 */
export function sequenceDiff<T>(before: readonly T[], after: readonly T[]): SequenceDiff<T> | null {
  const sharedLength = Math.min(before.length, after.length);
  let start = 0;

  while (start < sharedLength && before[start] === after[start]) {
    start += 1;
  }

  if (start === before.length && start === after.length) return null;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    start,
    removed: before.slice(start, beforeEnd),
    inserted: after.slice(start, afterEnd),
  };
}
