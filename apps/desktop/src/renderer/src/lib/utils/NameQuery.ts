import type { Named, NameQueryOptions } from "@/types/nameQuery";

/**
 * What the user typed into a search field, matched case-insensitively
 * against names.
 *
 * @remarks
 * The text is trimmed, and an empty query matches everything, so a cleared
 * field lists every item. Match a different field than `name` with
 * {@link matchesText} or {@link filterBy}.
 */
export class NameQuery {
  /** The query for no text, which matches everything. */
  static readonly EMPTY = new NameQuery("");

  /** The query for a search field's `text`. */
  static from(text: string, options: NameQueryOptions = {}): NameQuery {
    const { prefix } = options;
    const unprefixed = prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
    return new NameQuery(unprefixed.trim());
  }

  /** The typed text, trimmed, in the case it was typed. */
  readonly text: string;
  readonly #lower: string;

  private constructor(text: string) {
    this.text = text;
    this.#lower = text.toLowerCase();
  }

  /** Whether nothing was typed, so every item matches. */
  get isEmpty(): boolean {
    return this.text === "";
  }

  /** Whether `text` contains the query, ignoring case. */
  matchesText(text: string): boolean {
    return text.toLowerCase().includes(this.#lower);
  }

  /** Whether `text` is the query, ignoring case. */
  isExactly(text: string): boolean {
    return text.toLowerCase() === this.#lower;
  }

  /** Whether the item's name contains the query, ignoring case. */
  matches(item: Named): boolean {
    return this.matchesText(item.name);
  }

  /** The items whose name contains the query, in order; every item when the query is empty. */
  filter<T extends Named>(items: readonly T[]): T[] {
    return this.filterBy(items, (item) => [item.name]);
  }

  /**
   * The items with any of their searchable texts containing the query, in
   * order; every item when the query is empty.
   *
   * @param texts - The texts an item is found by, such as its name and display name.
   */
  filterBy<T>(items: readonly T[], texts: (item: T) => readonly string[]): T[] {
    if (this.isEmpty) return [...items];

    return items.filter((item) => texts(item).some((text) => this.matchesText(text)));
  }
}
