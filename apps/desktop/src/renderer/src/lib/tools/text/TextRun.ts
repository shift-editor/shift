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
import { Caret, TextLayout } from "./layout";
import type { Cell, Positioner } from "./layout";
import type { Font } from "@/lib/model/Font";

export interface SelectionRect {
  x: number;
  width: number;
  top: number;
  bottom: number;
}

export class TextRun {
  readonly buffer: TextBuffer;
  readonly interaction: TextInteraction;
  readonly #font: Font;
  readonly #positioner: Positioner;

  readonly #$cursorVisible: Signal<boolean>;
  readonly #$layout: ComputedSignal<TextLayout | null>;
  readonly #$caret: ComputedSignal<Caret | null>;
  readonly #$selectionRects: ComputedSignal<readonly SelectionRect[]>;

  #goalX: number | null = null;

  constructor(font: Font, positioner: Positioner) {
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
   * No-op on the seed if the buffer already has cells; originX is always set.
   */
  seed(cell: Cell, originX: number): void {
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

  // Vertical nav: deferred. No-op for now; lands when Caret.nextLine ships.
  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorUp(_extend = false): void {
    void this.#goalX; // TODO: read as goalX seed for Caret.previousLine
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorDown(_extend = false): void {
    /* TODO: Caret.nextLine(this.#goalX ??= caret.position().x) */
  }

  // Word and line-edge nav: deferred. No-op for now.
  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorByWord(_direction: -1 | 1, _extend = false): void {
    /* TODO: walk cells looking for word boundaries via codepoint classes */
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorToLineStart(_extend = false): void {
    /* TODO: find current line, set cursor to its clusterStart */
  }

  /** @knipclassignore — keyboard nav via HiddenTextInput */
  moveCursorToLineEnd(_extend = false): void {
    /* TODO: find current line, set cursor to its last caret position */
  }

  #resetGoalX(): void {
    this.#goalX = null;
  }
}

function computeSelectionRects(
  layout: TextLayout,
  range: { start: number; end: number },
): SelectionRect[] {
  const rects: SelectionRect[] = [];
  for (const line of layout.lines) {
    let cursor = layout.origin.x;
    let rectStart: number | null = null;
    let rectEnd = cursor;
    for (const run of line.runs) {
      for (const g of run.glyphs) {
        const left = cursor;
        const right = cursor + g.xAdvance;
        if (g.cluster >= range.start && g.cluster < range.end) {
          if (rectStart === null) rectStart = left;
          rectEnd = right;
        }
        cursor = right;
      }
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
