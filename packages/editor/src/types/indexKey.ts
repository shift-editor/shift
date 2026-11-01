import { indexKeys } from "@shift/wasm";

/**
 * A sibling's sort key among the nodes that share its parent.
 *
 * @remarks
 * A fractional index that shift-font makes (`index_key`, over the
 * `fractional_index` crate): a key between two others always exists, so
 * moving a node writes only that node's key. Keys are the crate's string
 * form, hex with two characters per byte, so they compare as plain strings.
 */
export type IndexKey = string;

export const IndexKey = {
  /**
   * Returns a key that sorts after `before` and before `after`.
   *
   * @param before - the key to sort after, or null for the first position.
   * @param after - the key to sort before, or null for the last position.
   * @throws {PackError} when a key is malformed, or `before` does not sort before `after`.
   */
  between(before: IndexKey | null, after: IndexKey | null): IndexKey {
    return indexKeys.between(before, after);
  },

  /**
   * Orders two keys: negative when `a` sorts first, positive when `b` does, 0 when equal.
   *
   * @remarks
   * Plain string order, which is the order of the keys' bytes, so it needs no
   * call into shift-font.
   */
  compare(a: IndexKey, b: IndexKey): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  },
};
