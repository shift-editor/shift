/**
 * Edits to lists of keyed values, such as entities by id.
 *
 * @remarks
 * Each takes a readonly list and returns a new one, keeping order, so a call
 * site never copies, finds an index and assigns by hand.
 */

/**
 * The list with `item` in place of the value with the same key, or appended
 * when there is none.
 */
export function upsertBy<T, K>(list: readonly T[], item: T, key: (value: T) => K): T[] {
  const id = key(item);
  const index = list.findIndex((value) => key(value) === id);
  return index === -1 ? [...list, item] : list.with(index, item);
}

/** The list with `change` applied to every value whose key is `id`. */
export function replaceBy<T, K>(
  list: readonly T[],
  id: K,
  change: (value: T) => T,
  key: (value: T) => K,
): T[] {
  return list.map((value) => (key(value) === id ? change(value) : value));
}

/** The list without the values whose key is `id`. */
export function removeBy<T, K>(list: readonly T[], id: K, key: (value: T) => K): T[] {
  return list.filter((value) => key(value) !== id);
}
