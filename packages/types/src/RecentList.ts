/** How a {@link RecentList} identifies, orders and bounds its items. */
export interface RecentListRules<T, Query> {
  /**
   * Whether `item` is the one `query` names. A predicate rather than a key, so
   * an item can be found by any of several identities (a path or a document id).
   */
  readonly matches: (item: T, query: Query) => boolean;
  /** When the item was last used, in epoch milliseconds; newer items come first. */
  readonly usedAt: (item: T) => number;
  /** Most items kept; the least recently used fall off. */
  readonly limit: number;
}

/**
 * Items newest first by last use, at most one per query, capped at a limit.
 *
 * @remarks
 * Immutable: every change returns a new list. The invariants (one item per
 * identity, newest first, no more than `limit`) hold after every change, so
 * callers never filter, sort or slice to restore them.
 */
export class RecentList<T, Query> implements Iterable<T> {
  /**
   * A list over `items`, ordered newest first and capped. Items with equal
   * use times keep their given order; duplicates are not merged.
   */
  static of<T, Query>(items: Iterable<T>, rules: RecentListRules<T, Query>): RecentList<T, Query> {
    const newestFirst = (a: T, b: T) => rules.usedAt(b) - rules.usedAt(a);
    return new RecentList(Array.from(items).sort(newestFirst).slice(0, rules.limit), rules);
  }

  readonly #items: readonly T[];
  readonly #rules: RecentListRules<T, Query>;

  private constructor(items: readonly T[], rules: RecentListRules<T, Query>) {
    this.#items = items;
    this.#rules = rules;
  }

  /** Every item, newest first. */
  get items(): readonly T[] {
    return this.#items;
  }

  get size(): number {
    return this.#items.length;
  }

  get isEmpty(): boolean {
    return this.#items.length === 0;
  }

  /** The first item `query` names, or null when there is none. */
  find(query: Query): T | null {
    return this.#items.find((item) => this.#rules.matches(item, query)) ?? null;
  }

  /** The items that pass `test`, newest first. */
  where(test: (item: T) => boolean): T[] {
    return this.#items.filter(test);
  }

  /**
   * Records a use: replaces every item `query` names with `make(previous)`,
   * placed by its use time ahead of items used at the same time or earlier,
   * and drops what falls past the limit.
   *
   * @param make - Builds the item from the first one `query` named, or from null when none did.
   */
  touch(query: Query, make: (previous: T | null) => T): RecentList<T, Query> {
    const item = make(this.find(query));
    const remaining = this.#items.filter((candidate) => !this.#rules.matches(candidate, query));
    const usedAt = this.#rules.usedAt(item);
    const index = remaining.findIndex((candidate) => this.#rules.usedAt(candidate) <= usedAt);
    const at = index === -1 ? remaining.length : index;
    const items = [...remaining.slice(0, at), item, ...remaining.slice(at)];
    return new RecentList(items.slice(0, this.#rules.limit), this.#rules);
  }

  /**
   * Changes the first item `query` names in place, keeping its position.
   *
   * @param change - Returns the changed item; it must keep the item's use time.
   * @returns this list when `query` names nothing.
   */
  update(query: Query, change: (item: T) => T): RecentList<T, Query> {
    const index = this.#items.findIndex((item) => this.#rules.matches(item, query));
    if (index === -1) return this;

    return new RecentList(this.#items.with(index, change(this.#items[index]!)), this.#rules);
  }

  /**
   * Changes every item, keeping the order.
   *
   * @param change - Returns the changed item; it must keep the item's use time.
   */
  map(change: (item: T) => T): RecentList<T, Query> {
    return new RecentList(this.#items.map(change), this.#rules);
  }

  /** Removes every item `query` names; returns this list when it names none. */
  remove(query: Query): RecentList<T, Query> {
    const items = this.#items.filter((item) => !this.#rules.matches(item, query));
    return items.length === this.#items.length ? this : new RecentList(items, this.#rules);
  }

  [Symbol.iterator](): Iterator<T> {
    return this.#items[Symbol.iterator]();
  }
}
