/**
 * TextRun — composes TextBuffer + TextInteraction, exposes reactive layout
 * and caret signals, owns transient nav state (#goalX for up/down arrow
 * goal-x persistence).
 *
 * Reactive boundaries:
 *   - layoutCell: computed from buffer.items + buffer.originX + font (rebuilt
 *     when any of those change). Cursor/anchor changes do NOT recompute.
 *   - caretCell: computed from layoutCell + buffer.cursor. Rebuilt on cursor move
 *     OR layout rebuild.
 *   - selectionRectsCell: computed from layoutCell + buffer.range + hasSelection.
 *
 * Cursor math lives on Caret. TextRun threads goalX through Caret.nextLine /
 * previousLine so vertical motion preserves horizontal position across short
 * lines. goalX resets on horizontal nav, click, and edits.
 */
import {
  signal,
  computed,
  type Signal,
  type ComputedSignal,
} from "@/lib/signals/signal";
import { TextBuffer } from "./TextBuffer";
import { TextInteraction } from "./TextInteraction";
import { Caret, glyphTextItem, TextLayout } from "./layout";
import type {
  TextItem,
  GlyphAnchor,
  GlyphTextItem,
  Positioner,
  TextRunId,
} from "./layout";
import type { Font } from "@/lib/model/Font";
import type { GlyphHandle } from "@shared/bridge/BridgeApi";
import type { Point2D } from "@shift/geo";
import type { AxisLocation } from "@/types/variation";

export interface SelectionRect {
  x: number;
  width: number;
  top: number;
  bottom: number;
}

export interface FocusedGlyph {
  anchor: GlyphAnchor;
  item: GlyphTextItem;
  glyph: GlyphHandle;
  editOrigin: Point2D;
}

export class TextRun {
  readonly id: TextRunId;
  readonly buffer: TextBuffer;
  readonly interaction: TextInteraction;
  readonly #font: Font;
  readonly #positioner: Positioner;
  readonly #designLocation: Signal<AxisLocation>;

  readonly #cursorVisible: ReturnType<typeof signal<boolean>>;
  readonly #layout: ComputedSignal<TextLayout | null>;
  readonly #caret: ComputedSignal<Caret | null>;
  readonly #selectionRects: ComputedSignal<readonly SelectionRect[]>;

  #goalX: number | null = null;

  constructor(
    id: TextRunId,
    font: Font,
    positioner: Positioner,
    designLocation: Signal<AxisLocation>,
  ) {
    this.id = id;
    this.buffer = new TextBuffer();
    this.interaction = new TextInteraction();
    this.#font = font;
    this.#positioner = positioner;
    this.#designLocation = designLocation;
    this.#cursorVisible = signal(false);

    this.#layout = computed(() => {
      const items = this.buffer.itemsCell.value;
      if (items.length === 0) return null;
      return new TextLayout({
        items,
        origin: { x: this.buffer.originXCell.value, y: 0 },
        font: this.#font,
        positioner: this.#positioner,
        designLocation: this.#designLocation,
      });
    });

    this.#caret = computed(() => {
      const layout = this.#layout.value;
      if (!layout) return null;
      return Caret.atCluster(layout, this.buffer.cursorCell.value);
    });

    this.#selectionRects = computed(() => {
      const layout = this.#layout.value;
      this.buffer.anchorCell.value;
      this.buffer.cursorCell.value;
      if (!layout || !this.buffer.hasSelection) return [];
      return computeSelectionRects(layout, this.buffer.range);
    });
  }

  /** @knipclassignore — read by TextRunRenderer when it lands */
  get cursorVisible(): boolean {
    return this.#cursorVisible.peek();
  }

  get cursorVisibleCell(): Signal<boolean> {
    return this.#cursorVisible;
  }

  get layoutCell(): Signal<TextLayout | null> {
    return this.#layout;
  }

  get caretCell(): Signal<Caret | null> {
    return this.#caret;
  }

  get selectionRectsCell(): Signal<readonly SelectionRect[]> {
    return this.#selectionRects;
  }

  setCursorVisible(visible: boolean): void {
    this.#cursorVisible.set(visible);
  }

  /**
   * Initialize the run with a single seed item at originX. Combines
   * `buffer.seed` + `buffer.setOriginX` so Text-tool activation is one call.
   *
   * No-op when the buffer already has items. Critically, this means originX
   * is *not* re-applied on re-activation — without that guard, the run
   * shifts every time the user toggles between Select and Text after
   * drawOffset has moved (e.g. via double-clicking a slot to edit it).
   */
  seed(item: TextItem, originX: number): void {
    if (this.buffer.length > 0) return;
    this.buffer.seed(item);
    this.buffer.setOriginX(originX);
  }

  /**
   * Insert one item at the cursor. Replaces selection if any; adjusts the
   * editing context's held indices for the buffer mutation; resets goalX.
   */
  insert(item: TextItem): void {
    const before = this.buffer.range;
    const deleteCount = before.end - before.start;
    this.buffer.insert(item);
    this.interaction.adjustForBufferChange(before.start, deleteCount, 1);
    this.#resetGoalX();
  }

  /** @knipclassignore — called via editor.textRun.insertMany (paste, IME commit) */
  insertMany(items: readonly TextItem[]): void {
    const before = this.buffer.range;
    const deleteCount = before.end - before.start;
    this.buffer.insertMany(items);
    this.interaction.adjustForBufferChange(
      before.start,
      deleteCount,
      items.length,
    );
    this.#resetGoalX();
  }

  /** @knipclassignore — called via editor.textRun.delete (Backspace) */
  delete(): boolean {
    const before = this.buffer.range;
    const wasSelection = this.buffer.hasSelection;
    const deleted = this.buffer.delete();
    if (!deleted) return false;
    if (wasSelection) {
      this.interaction.adjustForBufferChange(
        before.start,
        before.end - before.start,
        0,
      );
    } else {
      this.interaction.adjustForBufferChange(before.start - 1, 1, 0);
    }
    this.#resetGoalX();
    return true;
  }

  /** @knipclassignore — called via editor.textRun.deleteForward (Delete) */
  deleteForward(): boolean {
    const before = this.buffer.range;
    const wasSelection = this.buffer.hasSelection;
    const deleted = this.buffer.deleteForward();
    if (!deleted) return false;
    if (wasSelection) {
      this.interaction.adjustForBufferChange(
        before.start,
        before.end - before.start,
        0,
      );
    } else {
      this.interaction.adjustForBufferChange(before.start, 1, 0);
    }
    this.#resetGoalX();
    return true;
  }

  /** @knipclassignore — called via Select tool's text-run hit-test (TODO) */
  placeCaretAtPoint(p: { x: number; y: number }): void {
    const layout = this.#layout.peek();
    if (!layout) return;
    const hit = layout.hitTest(p);
    if (!hit) return;
    const cluster = hit.side === "left" ? hit.cluster : hit.cluster + 1;
    this.buffer.placeCaret(cluster);
    this.#resetGoalX();
  }

  anchorAtPoint(p: Point2D, padding = 0): GlyphAnchor | null {
    const layout = this.#layout.peek();
    return layout?.anchorAtPoint(this.id, p, padding) ?? null;
  }

  /**
   * Resolve a durable glyph anchor through current buffer and layout state.
   *
   *   run = [a(id=a1), a(id=a2), s(id=s1), d(id=d1)]
   *                              ▲
   *                              click
   *      │
   *      ▼
   *   GlyphAnchor { runId: run.id, itemId: s1 }
   *      │
   *      ▼
   *   resolveAnchor(anchor)
   *      │ reads current buffer + current layout
   *      ▼
   *   FocusedGlyph { glyph: "s", editOrigin }
   */
  resolveAnchor(anchor: GlyphAnchor): FocusedGlyph | null {
    if (anchor.runId !== this.id) return null;
    const item = this.buffer.itemById(anchor.itemId);
    if (!item || item.kind !== "glyph") return null;

    const editOrigin =
      this.#layout.peek()?.editOriginForItem(anchor.itemId) ?? null;
    if (!editOrigin) return null;

    return {
      anchor,
      item,
      glyph: {
        name: item.glyphName,
        ...(item.codepoint !== null ? { unicode: item.codepoint } : {}),
      },
      editOrigin,
    };
  }

  setSingleGlyph(handle: GlyphHandle): GlyphAnchor {
    const item = glyphTextItem(handle.name, handle.unicode ?? null);
    this.buffer.restore({
      items: [item],
      cursor: 1,
      anchor: 1,
      originX: 0,
    });
    this.interaction.clear();
    return { runId: this.id, itemId: item.id };
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorLeft(extend = false): void {
    this.#resetGoalX();
    const next = this.buffer.cursor - 1;
    if (extend) this.buffer.extendSelection(next);
    else this.buffer.placeCaret(next);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorRight(extend = false): void {
    this.#resetGoalX();
    const next = this.buffer.cursor + 1;
    if (extend) this.buffer.extendSelection(next);
    else this.buffer.placeCaret(next);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorUp(extend = false): void {
    const caret = this.#caret.peek();
    if (!caret) return;
    this.#goalX ??= caret.position().x;
    const next = caret.previousLine(this.#goalX);
    if (extend) this.buffer.extendSelection(next.cluster);
    else this.buffer.placeCaret(next.cluster);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorDown(extend = false): void {
    const caret = this.#caret.peek();
    if (!caret) return;
    this.#goalX ??= caret.position().x;
    const next = caret.nextLine(this.#goalX);
    if (extend) this.buffer.extendSelection(next.cluster);
    else this.buffer.placeCaret(next.cluster);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorByWord(direction: -1 | 1, extend = false): void {
    this.#resetGoalX();
    const items = this.buffer.items;
    let pos = this.buffer.cursor;

    if (direction === -1) {
      if (pos <= 0) return;
      pos--;
      while (pos > 0 && isWhitespaceItem(items[pos - 1])) pos--;
      while (
        pos > 0 &&
        !isWhitespaceItem(items[pos - 1]) &&
        !isPunctuationItem(items[pos - 1])
      ) {
        pos--;
      }
    } else {
      if (pos >= items.length) return;
      while (
        pos < items.length &&
        !isWhitespaceItem(items[pos]) &&
        !isPunctuationItem(items[pos])
      ) {
        pos++;
      }
      // while (pos < items.length && isWhitespaceItem(items[pos])) pos++;
    }

    if (extend) this.buffer.extendSelection(pos);
    else this.buffer.placeCaret(pos);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorToLineStart(extend = false): void {
    this.#resetGoalX();
    const lineIdx = this.#findCurrentLineIndex();
    if (lineIdx < 0) return;
    const target = this.#layout.peek()!.lines[lineIdx].clusterStart;
    if (extend) this.buffer.extendSelection(target);
    else this.buffer.placeCaret(target);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorToLineEnd(extend = false): void {
    this.#resetGoalX();
    const lineIdx = this.#findCurrentLineIndex();
    if (lineIdx < 0) return;
    const target = this.#layout.peek()!.lines[lineIdx].clusterEnd - 1;
    if (extend) this.buffer.extendSelection(target);
    else this.buffer.placeCaret(target);
  }

  #resetGoalX(): void {
    this.#goalX = null;
  }

  #findCurrentLineIndex(): number {
    const layout = this.#layout.peek();
    if (!layout) return -1;
    const cursor = this.buffer.cursor;
    for (const [i, line] of layout.lines.entries()) {
      if (cursor >= line.clusterStart && cursor < line.clusterEnd) return i;
    }
    return -1;
  }
}

function isWhitespaceItem(item: TextItem): boolean {
  if (item.kind === "linebreak") return true;
  if (item.codepoint === null) return false;
  return (
    item.codepoint === 0x20 ||
    item.codepoint === 0x09 ||
    item.codepoint === 0x0a
  );
}

function isPunctuationItem(item: TextItem): boolean {
  if (item.kind !== "glyph" || item.codepoint === null) return false;
  const cp = item.codepoint;
  return (
    (cp >= 0x21 && cp <= 0x2f) ||
    (cp >= 0x3a && cp <= 0x40) ||
    (cp >= 0x5b && cp <= 0x60) ||
    (cp >= 0x7b && cp <= 0x7e)
  );
}

function computeSelectionRects(
  layout: TextLayout,
  range: { start: number; end: number },
): SelectionRect[] {
  const rects: SelectionRect[] = [];
  for (const line of layout.lines) {
    let runBase = layout.origin.x;
    let rectStart: number | null = null;
    let rectEnd = runBase;
    for (const run of line.runs) {
      for (const g of run.glyphs) {
        const left = runBase + g.origin.x;
        const right = left + g.xAdvance;
        if (g.cluster >= range.start && g.cluster < range.end) {
          if (rectStart === null) rectStart = left;
          rectEnd = right;
        }
      }
      runBase += run.advance;
    }
    if (rectStart !== null) {
      rects.push({
        x: rectStart,
        width: rectEnd - rectStart,
        top: line.y + line.ascent,
        bottom: line.y + line.descent,
      });
    }
  }
  return rects;
}
