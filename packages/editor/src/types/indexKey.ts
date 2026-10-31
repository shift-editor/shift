import { indexKeys } from "@shift/wasm";

/**
 * A sibling's sort key among the nodes that share its parent.
 *
 * @remarks
 * A fractional index, made and ordered by shift-font (`index_key`): a key
 * between two others always exists, so moving a node writes only that node's
 * key.
 */
export type IndexKey = string;

export const IndexKey = {
  /**
   * Returns a key that sorts after `before` and before `after`.
   *
   * @param before - the key to sort after, or null for the first position.
   * @param after - the key to sort before, or null for the last position.
   * @throws {PackError} when a key is malformed or the two are equal.
   */
  between(before: IndexKey | null, after: IndexKey | null): IndexKey {
    return indexKeys.between(before, after);
  },

  /** Orders two keys: negative when `a` sorts first, positive when `b` does, 0 when equal. */
  compare(a: IndexKey, b: IndexKey): number {
    return indexKeys.compare(a, b);
  },
};
