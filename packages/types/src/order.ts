/**
 * Named orders for `toSorted` and `sort`.
 *
 * @remarks
 * A comparator written inline at a call site says how to order but not what
 * the order is, and the same one ends up written again elsewhere. Name the
 * order once here, or next to the type it orders, and pass it by name.
 */

/** Orders `a` before `b` when negative, after when positive, and keeps them when zero. */
export type Comparator<T> = (a: T, b: T) => number;

/** Smallest number first. */
export const ascending: Comparator<number> = (a, b) => a - b;

/** Largest number first. */
export const descending: Comparator<number> = (a, b) => b - a;

/** Strings in locale order. */
export const alphabetical: Comparator<string> = (a, b) => a.localeCompare(b);

/** Values with a `name`, in locale order of the name. */
export const byName: Comparator<{ readonly name: string }> = (a, b) => a.name.localeCompare(b.name);

/**
 * Orders values by a key read from each.
 *
 * @param key - Reads the value to compare, such as `(entry) => entry.openedAt`.
 * @param order - How keys compare, such as {@link ascending} or {@link alphabetical}.
 */
export function comparing<T, K>(key: (value: T) => K, order: Comparator<K>): Comparator<T> {
  return (a, b) => order(key(a), key(b));
}

/**
 * Orders by the first comparator, breaking ties with each later one in turn.
 *
 * @param comparators - The orders to apply, most significant first.
 */
export function orderBy<T>(...comparators: readonly Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }

    return 0;
  };
}
