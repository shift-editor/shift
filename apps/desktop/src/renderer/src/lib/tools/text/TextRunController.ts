/**
 * TextRunController — self-contained text buffer with cursor, selection, and layout.
 *
 * Owns the text editing model for the text tool. A hidden <textarea> feeds input
 * into this controller; the render pass reads from its reactive signal.
 *
 * Selection uses the anchor/focus model (same as DOM Selection API):
 * - anchor: where the selection started (stays put during shift+arrow)
 * - focus:  where the caret is (moves during shift+arrow)
 * - when anchor === focus, there is no selection (just a caret)
 */
import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";
import { computeTextLayout, type GlyphRef, type GlyphSlot, type TextLayout } from "./layout";
import type { Font } from "@/lib/editor/Font";
import type { FontMetrics } from "@shift/types";

export interface SelectionRange {
  /** Inclusive start index. */
  start: number;
  /** Exclusive end index. */
  end: number;
}

export interface SelectionRect {
  x: number;
  width: number;
  top: number;
  bottom: number;
}

export interface TextRunCompositeInspection {
  slotIndex: number;
  hoveredComponentIndex: number | null;
}

export interface TextRunRenderState {
  layout: TextLayout;
  cursorX: number | null;
  selection: SelectionRange | null;
  selectionRects: SelectionRect[];
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
  hoveredIndex: number | null;
  compositeInspection: TextRunCompositeInspection | null;
}

export interface TextRunSnapshot {
  glyphs: GlyphRef[];
  cursor: number;
  anchor: number;
  originX: number;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
}

export class TextRunController {
  #glyphs: GlyphRef[] = [];
  #cursor = 0;
  #anchor = 0;
  #originX = 0;
  #font: Font | null = null;
  #cursorVisible = false;

  #editingIndex: number | null = null;
  #editingGlyph: GlyphRef | null = null;
  #hoveredIndex: number | null = null;
  #inspectionSlotIndex: number | null = null;
  #inspectionHoveredComponentIndex: number | null = null;

  #$state: WritableSignal<TextRunRenderState | null>;

  constructor() {
    this.#$state = signal<TextRunRenderState | null>(null);
  }

  get state(): Signal<TextRunRenderState | null> {
    return this.#$state;
  }

  // ── Derived (read-only) ──────────────────────────────────────────

  get length(): number {
    return this.#glyphs.length;
  }

  get cursor(): number {
    return this.#cursor;
  }

  get anchor(): number {
    return this.#anchor;
  }

  get hasSelection(): boolean {
    return this.#anchor !== this.#cursor;
  }

  get selection(): SelectionRange | null {
    if (!this.hasSelection) return null;
    const start = Math.min(this.#anchor, this.#cursor);
    const end = Math.max(this.#anchor, this.#cursor);
    return { start, end };
  }

  get glyphs(): readonly GlyphRef[] {
    return this.#glyphs;
  }

  get selectedGlyphs(): GlyphRef[] {
    const sel = this.selection;
    if (!sel) return [];
    return this.#glyphs.slice(sel.start, sel.end);
  }

  // ── Cursor movement ──────────────────────────────────────────────

  /**
   * Move cursor left by one position.
   * @param extend - If true (shift held), keep anchor in place to grow/shrink selection.
   */
  moveCursorLeft(extend = false): void {
    if (!extend && this.hasSelection) {
      const start = Math.min(this.#anchor, this.#cursor);
      this.#cursor = start;
      this.#anchor = start;
      return;
    }

    if (this.#cursor > 0) {
      this.#cursor--;
    }

    if (!extend) {
      this.#anchor = this.#cursor;
    }
  }

  /**
   * Move cursor right by one position.
   * @param extend - If true (shift held), keep anchor in place to grow/shrink selection.
   */
  moveCursorRight(extend = false): void {
    if (!extend && this.hasSelection) {
      const end = Math.max(this.#anchor, this.#cursor);
      this.#cursor = end;
      this.#anchor = end;
      return;
    }

    if (this.#cursor < this.#glyphs.length) {
      this.#cursor++;
    }

    if (!extend) {
      this.#anchor = this.#cursor;
    }
  }

  /** Move cursor to start (Home / Cmd+Left). */
  moveCursorToStart(extend = false): void {
    this.#cursor = 0;
    if (!extend) {
      this.#anchor = 0;
    }
  }

  /** Move cursor to end (End / Cmd+Right). */
  moveCursorToEnd(extend = false): void {
    this.#cursor = this.#glyphs.length;
    if (!extend) {
      this.#anchor = this.#glyphs.length;
    }
  }

  // ── Selection ────────────────────────────────────────────────────

  /** Select all glyphs (Cmd+A). */
  selectAll(): void {
    this.#anchor = 0;
    this.#cursor = this.#glyphs.length;
  }

  /** Select a specific range. */
  selectRange(start: number, end: number): void {
    this.#anchor = Math.max(0, Math.min(start, this.#glyphs.length));
    this.#cursor = Math.max(0, Math.min(end, this.#glyphs.length));
  }

  /** Collapse selection to one side. */
  collapseSelection(to: "start" | "end" = "end"): void {
    const sel = this.selection;
    if (!sel) return;
    const pos = to === "start" ? sel.start : sel.end;
    this.#cursor = pos;
    this.#anchor = pos;
  }

  // ── Click placement ──────────────────────────────────────────────

  /** Click — collapse any selection and place caret at index. */
  placeCaret(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.#glyphs.length));
    this.#cursor = clamped;
    this.#anchor = clamped;
  }

  /** Shift+click — anchor stays, focus moves to index. */
  extendSelection(index: number): void {
    this.#cursor = Math.max(0, Math.min(index, this.#glyphs.length));
  }

  // ── Mutation ─────────────────────────────────────────────────────

  /** Insert a glyph at cursor. Replaces selection if any. */
  insert(glyph: GlyphRef): void {
    this.#deleteSelectionRange();
    this.#glyphs.splice(this.#cursor, 0, glyph);
    this.#cursor++;
    this.#anchor = this.#cursor;
  }

  /** Insert multiple glyphs at cursor (paste). Replaces selection if any. */
  insertMany(glyphs: GlyphRef[]): void {
    this.#deleteSelectionRange();
    this.#glyphs.splice(this.#cursor, 0, ...glyphs);
    this.#cursor += glyphs.length;
    this.#anchor = this.#cursor;
  }

  /** Backspace — delete selection, or the glyph before cursor. */
  delete(): boolean {
    if (this.hasSelection) {
      this.#deleteSelectionRange();
      return true;
    }

    if (this.#cursor === 0) return false;
    this.#cursor--;
    this.#glyphs.splice(this.#cursor, 1);
    this.#anchor = this.#cursor;
    return true;
  }

  /** Delete key — delete selection, or the glyph after cursor. */
  deleteForward(): boolean {
    if (this.hasSelection) {
      this.#deleteSelectionRange();
      return true;
    }

    if (this.#cursor >= this.#glyphs.length) return false;
    this.#glyphs.splice(this.#cursor, 1);
    return true;
  }

  // ── Text run lifecycle ───────────────────────────────────────────

  /** Seed with an initial glyph if buffer is empty. */
  seed(glyph: GlyphRef): void {
    if (this.#glyphs.length > 0) return;
    this.#glyphs.push(glyph);
    this.#cursor = 1;
    this.#anchor = 1;
  }

  clear(): void {
    this.#glyphs = [];
    this.#cursor = 0;
    this.#anchor = 0;
    this.#originX = 0;
    this.#cursorVisible = false;
    this.#editingIndex = null;
    this.#editingGlyph = null;
    this.#hoveredIndex = null;
    this.#inspectionSlotIndex = null;
    this.#inspectionHoveredComponentIndex = null;
    this.#$state.set(null);
  }

  /** @knipclassignore — consumed when wired to text tool */
  setFont(font: Font): void {
    this.#font = font;
  }

  setOriginX(x: number): void {
    this.#originX = x;
  }

  /** @knipclassignore — consumed when wired to text tool */
  setCursorVisible(visible: boolean): void {
    this.#cursorVisible = visible;
  }

  /**
   * Recompute layout and selection rects, then push to the reactive signal.
   * Call after any mutation or cursor movement.
   * @knipclassignore — consumed when wired to text tool
   */
  recompute(): void {
    if (!this.#font) {
      this.#$state.set(null);
      return;
    }

    const layout =
      this.#glyphs.length > 0
        ? computeTextLayout(this.#glyphs, { x: this.#originX, y: 0 }, this.#font)
        : { slots: [], totalAdvance: 0 };

    if (this.#glyphs.length === 0 && !this.#cursorVisible) {
      this.#$state.set(null);
      return;
    }

    const sel = this.selection;
    const metrics = this.#font.getMetrics();
    const selectionRects = sel ? computeSelectionRects(layout.slots, sel, metrics) : [];

    this.#$state.set({
      layout,
      cursorX: this.#cursorVisible && !this.hasSelection ? this.#computeCursorX(layout) : null,
      selection: sel,
      selectionRects,
      editingIndex: this.#editingIndex,
      editingGlyph: this.#editingGlyph,
      hoveredIndex: this.#hoveredIndex,
      compositeInspection: this.#compositeInspection(),
    });
  }

  // ── Editing slot ─────────────────────────────────────────────────

  /** @knipclassignore — consumed when wired to text tool */
  setEditingSlot(index: number | null, glyph: GlyphRef | null = null): void {
    this.#editingIndex = index;
    this.#editingGlyph = glyph;
  }

  /** @knipclassignore — consumed when wired to text tool */
  resetEditingContext(): void {
    this.#editingIndex = null;
    this.#editingGlyph = null;
    this.#hoveredIndex = null;
    this.#inspectionSlotIndex = null;
    this.#inspectionHoveredComponentIndex = null;
  }

  // ── Hover / inspection ───────────────────────────────────────────

  /** @knipclassignore — consumed when wired to text tool */
  setHovered(index: number | null): void {
    this.#hoveredIndex = index;
    if (this.#inspectionSlotIndex !== index) {
      this.#inspectionHoveredComponentIndex = null;
    }
  }

  /** @knipclassignore — consumed when wired to text tool */
  setInspectionSlot(index: number | null): void {
    this.#inspectionSlotIndex = index;
    this.#inspectionHoveredComponentIndex = null;
  }

  /** @knipclassignore — consumed when wired to text tool */
  setInspectionHoveredComponent(index: number | null): void {
    this.#inspectionHoveredComponentIndex = this.#inspectionSlotIndex === null ? null : index;
  }

  /** @knipclassignore — consumed when wired to text tool */
  clearInspection(): void {
    this.#inspectionSlotIndex = null;
    this.#inspectionHoveredComponentIndex = null;
  }

  // ── Serialization ────────────────────────────────────────────────

  snapshot(): TextRunSnapshot {
    return {
      glyphs: [...this.#glyphs],
      cursor: this.#cursor,
      anchor: this.#anchor,
      originX: this.#originX,
      editingIndex: this.#editingIndex,
      editingGlyph: this.#editingGlyph,
    };
  }

  restore(snapshot: TextRunSnapshot): void {
    this.#glyphs = [...snapshot.glyphs];
    this.#cursor = snapshot.cursor;
    this.#anchor = snapshot.anchor;
    this.#originX = snapshot.originX;
    this.#editingIndex = snapshot.editingIndex;
    this.#editingGlyph = snapshot.editingGlyph;
  }

  // ── Private ──────────────────────────────────────────────────────

  #deleteSelectionRange(): void {
    const sel = this.selection;
    if (!sel) return;
    this.#glyphs.splice(sel.start, sel.end - sel.start);
    this.#cursor = sel.start;
    this.#anchor = sel.start;
  }

  #computeCursorX(layout: TextLayout): number | null {
    if (!this.#cursorVisible) return null;

    if (this.#cursor === 0) return this.#originX;

    if (this.#cursor <= layout.slots.length) {
      const prevSlot = layout.slots[this.#cursor - 1];
      if (prevSlot) return prevSlot.x + prevSlot.advance;
    }

    return this.#originX + layout.totalAdvance;
  }

  #compositeInspection(): TextRunCompositeInspection | null {
    if (this.#inspectionSlotIndex === null) return null;
    return {
      slotIndex: this.#inspectionSlotIndex,
      hoveredComponentIndex: this.#inspectionHoveredComponentIndex,
    };
  }
}

function computeSelectionRects(
  slots: GlyphSlot[],
  selection: SelectionRange,
  metrics: FontMetrics,
): SelectionRect[] {
  const rects: SelectionRect[] = [];

  for (let i = selection.start; i < selection.end; i++) {
    const slot = slots[i];
    if (!slot) continue;

    rects.push({
      x: slot.x,
      width: Math.max(slot.advance, 0),
      top: metrics.ascender,
      bottom: metrics.descender,
    });
  }

  return mergeAdjacentRects(rects);
}

/**
 * Merge consecutive selection rects that share an edge into single rects.
 * Reduces draw calls for contiguous selections.
 */
function mergeAdjacentRects(rects: SelectionRect[]): SelectionRect[] {
  if (rects.length <= 1) return rects;

  const merged: SelectionRect[] = [rects[0]];

  for (let i = 1; i < rects.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = rects[i];

    const prevEnd = prev.x + prev.width;
    if (Math.abs(prevEnd - curr.x) < 0.5 && prev.top === curr.top && prev.bottom === curr.bottom) {
      prev.width = curr.x + curr.width - prev.x;
    } else {
      merged.push(curr);
    }
  }

  return merged;
}
