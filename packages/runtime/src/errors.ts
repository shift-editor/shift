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

/**
 * Thrown when text is not proof text: a `/` that names no glyph, at the end
 * of the text or before a space. A slash is written `//`.
 */
export class ProofTextError extends Error {
  override readonly name = "ProofTextError";
}

/** Thrown when a caret position or selection falls outside its run, or the position is not at one end of the selection. */
export class TextCaretError extends Error {
  override readonly name = "TextCaretError";
}
