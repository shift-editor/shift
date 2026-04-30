/**
 * TextRun — composes TextBuffer + TextInteraction, exposes reactive layout
 * and caret signals, owns transient nav state (#goalX for up/down arrow
 * goal-x persistence).
 *
 * Reactive boundaries:
 *   - $layout: computed from buffer.cells + buffer.originX + font (rebuilt
 *     when any of those change). Cursor/anchor changes do NOT recompute.
 *   - $caret: computed from $layout + buffer.cursor. Rebuilt on cursor move
 *     OR layout rebuild.
 *   - $selectionRects: computed from $layout + buffer.range + hasSelection.
 *
 * Cursor math lives on Caret. TextRun threads goalX through Caret.nextLine /
 * previousLine so vertical motion preserves horizontal position across short
 * lines. goalX resets on horizontal nav, click, and edits.
 */
import { signal, computed, type Signal, type ComputedSignal } from "@/lib/reactive/signal";
import { TextBuffer } from "./TextBuffer";
import { TextInteraction } from "./TextInteraction";
import { Caret, glyphCell, TextLayout } from "./layout";
import type { Cell, GlyphAnchor, GlyphCell, Positioner, TextRunId } from "./layout";
import type { Font } from "@/lib/model/Font";
import type { GlyphHandle } from "@shared/bridge/FontEngineAPI";
import type { Point2D } from "@shift/types";

export interface SelectionRect {
  x: number;
  width: number;
  top: number;
  bottom: number;
}

export interface FocusedGlyph {
  anchor: GlyphAnchor;
  cell: GlyphCell;
  glyph: GlyphHandle;
  editOrigin: Point2D;
}

export class TextRun {
  readonly id: TextRunId;
  readonly buffer: TextBuffer;
  readonly interaction: TextInteraction;
  readonly #font: Font;
  readonly #positioner: Positioner;

  readonly #$cursorVisible: Signal<boolean>;
  readonly #$layout: ComputedSignal<TextLayout | null>;
  readonly #$caret: ComputedSignal<Caret | null>;
  readonly #$selectionRects: ComputedSignal<readonly SelectionRect[]>;

  #goalX: number | null = null;

  constructor(id: TextRunId, font: Font, positioner: Positioner) {
    this.id = id;
    this.buffer = new TextBuffer();
    this.interaction = new TextInteraction();
    this.#font = font;
    this.#positioner = positioner;
    this.#$cursorVisible = signal(false);

    this.#$layout = computed(() => {
      const cells = this.buffer.cells;
      if (cells.length === 0) return null;
      return new TextLayout({
        cells,
        origin: { x: this.buffer.originX, y: 0 },
        font: this.#font,
        positioner: this.#positioner,
      });
    });

    this.#$caret = computed(() => {
      const layout = this.#$layout.value;
      if (!layout) return null;
      return Caret.atCluster(layout, this.buffer.cursor);
    });

    this.#$selectionRects = computed(() => {
      const layout = this.#$layout.value;
      if (!layout || !this.buffer.hasSelection) return [];
      return computeSelectionRects(layout, this.buffer.range);
    });
  }

  /** @knipclassignore — read by TextRunRenderer when it lands */
  get cursorVisible(): boolean {
    return this.#$cursorVisible.value;
  }

  /** @knipclassignore — read by TextRunRenderer / Caret-via-effect callers */
  get $layout(): Signal<TextLayout | null> {
    return this.#$layout;
  }

  /** @knipclassignore — read by TextRunRenderer / Caret callers */
  get $caret(): Signal<Caret | null> {
    return this.#$caret;
  }

  /** @knipclassignore — read by TextRunRenderer */
  get $selectionRects(): Signal<readonly SelectionRect[]> {
    return this.#$selectionRects;
  }

  setCursorVisible(visible: boolean): void {
    (this.#$cursorVisible as ReturnType<typeof signal<boolean>>).set(visible);
  }

  /**
   * Initialize the run with a single seed cell at originX. Combines
   * `buffer.seed` + `buffer.setOriginX` so Text-tool activation is one call.
   *
   * No-op when the buffer already has cells. Critically, this means originX
   * is *not* re-applied on re-activation — without that guard, the run
   * shifts every time the user toggles between Select and Text after
   * drawOffset has moved (e.g. via double-clicking a slot to edit it).
   */
  seed(cell: Cell, originX: number): void {
    if (this.buffer.length > 0) return;
    this.buffer.seed(cell);
    this.buffer.setOriginX(originX);
  }

  /**
   * Insert one cell at the cursor. Replaces selection if any; adjusts the
   * editing context's held indices for the buffer mutation; resets goalX.
   */
  insert(cell: Cell): void {
    const before = this.buffer.range;
    const deleteCount = before.end - before.start;
    this.buffer.insert(cell);
    this.interaction.adjustForBufferChange(before.start, deleteCount, 1);
    this.#resetGoalX();
  }

  /** @knipclassignore — called via editor.textRun.insertMany (paste, IME commit) */
  insertMany(cells: readonly Cell[]): void {
    const before = this.buffer.range;
    const deleteCount = before.end - before.start;
    this.buffer.insertMany(cells);
    this.interaction.adjustForBufferChange(before.start, deleteCount, cells.length);
    this.#resetGoalX();
  }

  /** @knipclassignore — called via editor.textRun.delete (Backspace) */
  delete(): boolean {
    const before = this.buffer.range;
    const wasSelection = this.buffer.hasSelection;
    const deleted = this.buffer.delete();
    if (!deleted) return false;
    if (wasSelection) {
      this.interaction.adjustForBufferChange(before.start, before.end - before.start, 0);
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
      this.interaction.adjustForBufferChange(before.start, before.end - before.start, 0);
    } else {
      this.interaction.adjustForBufferChange(before.start, 1, 0);
    }
    this.#resetGoalX();
    return true;
  }

  /** @knipclassignore — called via Select tool's text-run hit-test (TODO) */
  placeCaretAtPoint(p: { x: number; y: number }): void {
    const layout = this.#$layout.peek();
    if (!layout) return;
    const hit = layout.hitTest(p);
    if (!hit) return;
    const cluster = hit.side === "left" ? hit.cluster : hit.cluster + 1;
    this.buffer.placeCaret(cluster);
    this.#resetGoalX();
  }

  anchorAtPoint(p: Point2D, padding = 0): GlyphAnchor | null {
    const layout = this.#$layout.peek();
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
   *   GlyphAnchor { runId: run.id, cellId: s1 }
   *      │
   *      ▼
   *   resolveAnchor(anchor)
   *      │ reads current buffer + current layout
   *      ▼
   *   FocusedGlyph { glyph: "s", editOrigin }
   */
  resolveAnchor(anchor: GlyphAnchor): FocusedGlyph | null {
    if (anchor.runId !== this.id) return null;
    const cell = this.buffer.cellById(anchor.cellId);
    if (!cell || cell.kind !== "glyph") return null;

    const editOrigin = this.#$layout.peek()?.editOriginForCell(anchor.cellId) ?? null;
    if (!editOrigin) return null;

    return {
      anchor,
      cell,
      glyph: {
        glyphName: cell.glyphName,
        ...(cell.codepoint !== null ? { unicode: cell.codepoint } : {}),
      },
      editOrigin,
    };
  }

  setSingleGlyph(handle: GlyphHandle): GlyphAnchor {
    const cell = glyphCell(handle.glyphName, handle.unicode ?? null);
    this.buffer.restore({
      cells: [cell],
      cursor: 1,
      anchor: 1,
      originX: 0,
    });
    this.interaction.clear();
    return { runId: this.id, cellId: cell.id };
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
    const caret = this.#$caret.peek();
    if (!caret) return;
    this.#goalX ??= caret.position().x;
    const next = caret.previousLine(this.#goalX);
    if (extend) this.buffer.extendSelection(next.cluster);
    else this.buffer.placeCaret(next.cluster);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorDown(extend = false): void {
    const caret = this.#$caret.peek();
    if (!caret) return;
    this.#goalX ??= caret.position().x;
    const next = caret.nextLine(this.#goalX);
    if (extend) this.buffer.extendSelection(next.cluster);
    else this.buffer.placeCaret(next.cluster);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorByWord(direction: -1 | 1, extend = false): void {
    this.#resetGoalX();
    const cells = this.buffer.cells;
    let pos = this.buffer.cursor;

    if (direction === -1) {
      if (pos <= 0) return;
      pos--;
      while (pos > 0 && isWhitespaceCell(cells[pos - 1])) pos--;
      while (pos > 0 && !isWhitespaceCell(cells[pos - 1]) && !isPunctuationCell(cells[pos - 1])) {
        pos--;
      }
    } else {
      if (pos >= cells.length) return;
      while (
        pos < cells.length &&
        !isWhitespaceCell(cells[pos]) &&
        !isPunctuationCell(cells[pos])
      ) {
        pos++;
      }
      // while (pos < cells.length && isWhitespaceCell(cells[pos])) pos++;
    }

    if (extend) this.buffer.extendSelection(pos);
    else this.buffer.placeCaret(pos);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorToLineStart(extend = false): void {
    this.#resetGoalX();
    const lineIdx = this.#findCurrentLineIndex();
    if (lineIdx < 0) return;
    const target = this.#$layout.peek()!.lines[lineIdx].clusterStart;
    if (extend) this.buffer.extendSelection(target);
    else this.buffer.placeCaret(target);
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorToLineEnd(extend = false): void {
    this.#resetGoalX();
    const lineIdx = this.#findCurrentLineIndex();
    if (lineIdx < 0) return;
    const target = this.#$layout.peek()!.lines[lineIdx].clusterEnd - 1;
    if (extend) this.buffer.extendSelection(target);
    else this.buffer.placeCaret(target);
  }

  #resetGoalX(): void {
    this.#goalX = null;
  }

  #findCurrentLineIndex(): number {
    const layout = this.#$layout.peek();
    if (!layout) return -1;
    const cursor = this.buffer.cursor;
    for (const [i, line] of layout.lines.entries()) {
      if (cursor >= line.clusterStart && cursor < line.clusterEnd) return i;
    }
    return -1;
  }
}

function isWhitespaceCell(cell: Cell): boolean {
  if (cell.kind === "linebreak") return true;
  if (cell.codepoint === null) return false;
  return cell.codepoint === 0x20 || cell.codepoint === 0x09 || cell.codepoint === 0x0a;
}

function isPunctuationCell(cell: Cell): boolean {
  if (cell.kind !== "glyph" || cell.codepoint === null) return false;
  const cp = cell.codepoint;
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
