import type { NodeId } from "@shift/types";

/** Thrown when a text run id names no canvas text run in the window. */
export class TextRunNotFoundError extends Error {
  override readonly name = "TextRunNotFoundError";
  readonly runId: NodeId;

  constructor(runId: NodeId) {
    super(`No text run ${runId} in this window; text.runs lists the runs on a page`);
    this.runId = runId;
  }
}

/**
 * Thrown when a page id names no page in the window's document, or, with no
 * id, when the window shows no page.
 */
export class PageNotFoundError extends Error {
  override readonly name = "PageNotFoundError";
  /** The page asked for; null when the call meant the page shown. */
  readonly pageId: NodeId | null;

  constructor(pageId: NodeId | null) {
    super(
      pageId === null
        ? "This window shows no page; pass a pageId from editor.inspect's pages"
        : `No page ${pageId} in this document; editor.inspect lists its pages`,
    );
    this.pageId = pageId;
  }
}

/** Thrown when text names a glyph, as `/name`, that the font does not have. */
export class UnknownGlyphNameError extends Error {
  override readonly name = "UnknownGlyphNameError";
  /** Each unknown name once, in the order the text gives them. */
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    const unique = [...new Set(names)];
    super(
      `The font has no glyph named ${unique.map((name) => `"${name}"`).join(", ")}; ` +
        "/name picks a glyph by its name in glyphs.list",
    );
    this.names = unique;
  }
}

/** Thrown when a caret position or selection falls outside its run, or the position is not at one end of the selection. */
export class TextCaretError extends Error {
  override readonly name = "TextCaretError";
}
