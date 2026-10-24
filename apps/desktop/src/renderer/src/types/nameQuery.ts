/** Something listed and searched by name: a glyph, group, theme. */
export interface Named {
  readonly name: string;
}

/** How a search field's text becomes a query. */
export interface NameQueryOptions {
  /**
   * A marker the user may type first that is not part of the name, such as
   * `@` before a kerning group. Removed only when the text starts with it.
   */
  readonly prefix?: string;
}
