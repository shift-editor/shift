import type { Editor } from "@shift/editor";
import type { PageNode } from "@shift/editor/types";
import type {
  GlyphId,
  LayerScope,
  MarkColor,
  MetricsKeySide,
  SidebearingEdit,
  SourceId,
} from "@shift/types";

/**
 * What the glyph grid does to the glyphs selected in it. Each action is one
 * undo step, whatever the number of glyphs.
 */
export class GridActions {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Tags the glyphs with a colour, or clears their colour with null. */
  tag(glyphIds: readonly GlyphId[], color: MarkColor | null): void {
    this.#editor.setMarkColor(glyphIds, color);
  }

  /**
   * Copies the glyphs: `a` becomes `a.001`, with no code points.
   *
   * @returns The copies' ids, in order, once the font has them.
   */
  async duplicate(glyphIds: readonly GlyphId[]): Promise<GlyphId[]> {
    const { font } = this.#editor;
    const copyIds = this.#editor.transaction("Duplicate Glyphs", () =>
      font.duplicateGlyphs(glyphIds),
    );
    await font.editCoordinator.settled();
    return copyIds;
  }

  /** Whether any of the glyphs has a component to decompose. */
  canDecompose(glyphIds: readonly GlyphId[]): boolean {
    return glyphIds.some((glyphId) => this.#editor.font.hasComponents(glyphId));
  }

  /** Turns the glyphs' components into contours in every master, nested ones too. */
  decompose(glyphIds: readonly GlyphId[]): void {
    this.#editor.transaction("Decompose Components", () =>
      this.#editor.font.decomposeGlyphs(glyphIds),
    );
  }

  /** Edits the glyphs' left and right sidebearings in one source or in every master. */
  setSidebearings(
    glyphIds: readonly GlyphId[],
    scope: LayerScope,
    left: SidebearingEdit,
    right: SidebearingEdit,
  ): void {
    this.#editor.transaction("Set Sidebearings", () =>
      this.#editor.font.setSidebearings(glyphIds, scope, left, right),
    );
  }

  /** The source a "current master" edit changes: the one being edited, or else the default. */
  get currentSourceId(): SourceId {
    return this.#editor.activeSourceIdCell.peek() ?? this.#editor.font.defaultSource.id;
  }

  /**
   * How many of the glyphs' `side`s a key holds in the scope's sources, which
   * an adjustment leaves alone: a right sidebearing is also held by a key on
   * the width.
   */
  linkedSideCount(glyphIds: readonly GlyphId[], scope: LayerScope, side: MetricsKeySide): number {
    const { font } = this.#editor;
    const sourceIds =
      scope.kind === "source"
        ? [scope.source]
        : font.sources.filter((source) => source.role === "master").map((source) => source.id);
    const holding: readonly MetricsKeySide[] = side === "right" ? ["right", "width"] : [side];
    let count = 0;
    for (const sourceId of sourceIds) {
      for (const glyphId of glyphIds) {
        const linked = font.linkedSides(glyphId, sourceId);
        if (linked.some((link) => holding.includes(link.side))) count += 1;
      }
    }
    return count;
  }

  /**
   * Puts the glyphs on a new page as one line of text, in the order given,
   * and returns the page; null when none of them can be set as text.
   *
   * @remarks
   * The glyphs must be loaded. The page is the caller's to show.
   */
  openAsText(glyphIds: readonly GlyphId[]): PageNode | null {
    const { text, pages } = this.#editor;
    if (!glyphIds.some((glyphId) => text.glyphItem(glyphId) !== null)) return null;

    // Adding the page is the undo step; its text goes with it.
    const page = pages.create();
    text.placeRun({ page, at: { x: 0, y: 0 }, glyphs: glyphIds });
    return page;
  }
}
