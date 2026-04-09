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

/** Persisted form of a single text run (serializable to JSON). */
export interface PersistedTextRun {
  glyphs: GlyphRef[];
  cursorPosition: number;
  originX: number;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
}

const DEFAULT_TEXT_RUN_KEY = "__default__";

interface RunState {
  glyphs: GlyphRef[];
  cursor: number;
  anchor: number;
  originX: number;
  cursorVisible: boolean;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
  hoveredIndex: number | null;
  inspectionSlotIndex: number | null;
  inspectionHoveredComponentIndex: number | null;
}

function createRunState(): RunState {
  return {
    glyphs: [],
    cursor: 0,
    anchor: 0,
    originX: 0,
    cursorVisible: false,
    editingIndex: null,
    editingGlyph: null,
    hoveredIndex: null,
    inspectionSlotIndex: null,
    inspectionHoveredComponentIndex: null,
  };
}

export class TextRunController {
  #runs = new Map<string, RunState>();
  #activeKey = DEFAULT_TEXT_RUN_KEY;
  #font: Font | null = null;

  #$state: WritableSignal<TextRunRenderState | null>;

  constructor() {
    this.#$state = signal<TextRunRenderState | null>(null);
  }

  /** Switch which glyph's text run is active. */
  setOwnerGlyph(glyph: GlyphRef | null): void {
    const nextKey = glyph ? glyph.glyphName : DEFAULT_TEXT_RUN_KEY;
    if (nextKey === this.#activeKey) return;

    this.#activeKey = nextKey;
    const run = this.#run();
    run.hoveredIndex = null;
    run.inspectionSlotIndex = null;
    run.inspectionHoveredComponentIndex = null;
  }

  get state(): Signal<TextRunRenderState | null> {
    return this.#$state;
  }

  // ── Derived (read-only) ──────────────────────────────────────────

  get length(): number {
    return this.#run().glyphs.length;
  }

  get cursor(): number {
    return this.#run().cursor;
  }

  get anchor(): number {
    return this.#run().anchor;
  }

  get hasSelection(): boolean {
    const r = this.#run();
    return r.anchor !== r.cursor;
  }

  get selection(): SelectionRange | null {
    const r = this.#run();
    if (r.anchor === r.cursor) return null;
    const start = Math.min(r.anchor, r.cursor);
    const end = Math.max(r.anchor, r.cursor);
    return { start, end };
  }

  get glyphs(): readonly GlyphRef[] {
    return this.#run().glyphs;
  }

  get selectedGlyphs(): GlyphRef[] {
    const sel = this.selection;
    if (!sel) return [];
    return this.#run().glyphs.slice(sel.start, sel.end);
  }

  // ── Cursor movement ──────────────────────────────────────────────

  /**
   * Move cursor left by one position.
   * @param extend - If true (shift held), keep anchor in place to grow/shrink selection.
   */
  moveCursorLeft(extend = false): void {
    const r = this.#run();

    if (!extend && this.hasSelection) {
      const start = Math.min(r.anchor, r.cursor);
      r.cursor = start;
      r.anchor = start;
      return;
    }

    if (r.cursor > 0) {
      r.cursor--;
    }

    if (!extend) {
      r.anchor = r.cursor;
    }
  }

  /**
   * Move cursor right by one position.
   * @param extend - If true (shift held), keep anchor in place to grow/shrink selection.
   */
  moveCursorRight(extend = false): void {
    const r = this.#run();

    if (!extend && this.hasSelection) {
      const end = Math.max(r.anchor, r.cursor);
      r.cursor = end;
      r.anchor = end;
      return;
    }

    if (r.cursor < r.glyphs.length) {
      r.cursor++;
    }

    if (!extend) {
      r.anchor = r.cursor;
    }
  }

  /** Move cursor to start (Home / Cmd+Left). */
  moveCursorToStart(extend = false): void {
    const r = this.#run();
    r.cursor = 0;
    if (!extend) {
      r.anchor = 0;
    }
  }

  /** Move cursor to end (End / Cmd+Right). */
  moveCursorToEnd(extend = false): void {
    const r = this.#run();
    r.cursor = r.glyphs.length;
    if (!extend) {
      r.anchor = r.glyphs.length;
    }
  }

  // ── Selection ────────────────────────────────────────────────────

  /** Select all glyphs (Cmd+A). */
  selectAll(): void {
    const r = this.#run();
    r.anchor = 0;
    r.cursor = r.glyphs.length;
  }

  /** Select a specific range. */
  selectRange(start: number, end: number): void {
    const r = this.#run();
    r.anchor = Math.max(0, Math.min(start, r.glyphs.length));
    r.cursor = Math.max(0, Math.min(end, r.glyphs.length));
  }

  /** Collapse selection to one side. */
  collapseSelection(to: "start" | "end" = "end"): void {
    const sel = this.selection;
    if (!sel) return;
    const r = this.#run();
    const pos = to === "start" ? sel.start : sel.end;
    r.cursor = pos;
    r.anchor = pos;
  }

  // ── Click placement ──────────────────────────────────────────────

  /** Click — collapse any selection and place caret at index. */
  placeCaret(index: number): void {
    const r = this.#run();
    const clamped = Math.max(0, Math.min(index, r.glyphs.length));
    r.cursor = clamped;
    r.anchor = clamped;
  }

  /** Shift+click — anchor stays, focus moves to index. */
  extendSelection(index: number): void {
    const r = this.#run();
    r.cursor = Math.max(0, Math.min(index, r.glyphs.length));
  }

  // ── Mutation ─────────────────────────────────────────────────────

  /** Insert a glyph at cursor. Replaces selection if any. */
  insert(glyph: GlyphRef): void {
    const r = this.#run();
    this.#deleteSelectionRange(r);
    r.glyphs.splice(r.cursor, 0, glyph);
    r.cursor++;
    r.anchor = r.cursor;
  }

  /** Insert a glyph at a specific index (for composite drill-down). */
  insertAt(index: number, glyph: GlyphRef): void {
    const r = this.#run();
    const clamped = Math.max(0, Math.min(index, r.glyphs.length));
    r.glyphs.splice(clamped, 0, glyph);
    if (r.cursor >= clamped) r.cursor++;
    if (r.anchor >= clamped) r.anchor++;
  }

  /** Insert multiple glyphs at cursor (paste). Replaces selection if any. */
  insertMany(glyphs: GlyphRef[]): void {
    const r = this.#run();
    this.#deleteSelectionRange(r);
    r.glyphs.splice(r.cursor, 0, ...glyphs);
    r.cursor += glyphs.length;
    r.anchor = r.cursor;
  }

  /** Backspace — delete selection, or the glyph before cursor. */
  delete(): boolean {
    const r = this.#run();

    if (this.hasSelection) {
      this.#deleteSelectionRange(r);
      return true;
    }

    if (r.cursor === 0) return false;
    r.cursor--;
    r.glyphs.splice(r.cursor, 1);
    r.anchor = r.cursor;
    return true;
  }

  /** Delete key — delete selection, or the glyph after cursor. */
  deleteForward(): boolean {
    const r = this.#run();

    if (this.hasSelection) {
      this.#deleteSelectionRange(r);
      return true;
    }

    if (r.cursor >= r.glyphs.length) return false;
    r.glyphs.splice(r.cursor, 1);
    return true;
  }

  // ── Text run lifecycle ───────────────────────────────────────────

  /** Seed with an initial glyph if buffer is empty. */
  seed(glyph: GlyphRef): void {
    const r = this.#run();
    if (r.glyphs.length > 0) return;
    r.glyphs.push(glyph);
    r.cursor = 1;
    r.anchor = 1;
  }

  clear(): void {
    const r = this.#run();
    r.glyphs = [];
    r.cursor = 0;
    r.anchor = 0;
    r.originX = 0;
    r.cursorVisible = false;
    r.editingIndex = null;
    r.editingGlyph = null;
    r.hoveredIndex = null;
    r.inspectionSlotIndex = null;
    r.inspectionHoveredComponentIndex = null;
    this.#$state.set(null);
  }

  clearAll(): void {
    this.#runs.clear();
    this.#$state.set(null);
  }

  setFont(font: Font): void {
    this.#font = font;
  }

  setOriginX(x: number): void {
    this.#run().originX = x;
  }

  setCursorVisible(visible: boolean): void {
    this.#run().cursorVisible = visible;
  }

  /** @knipclassignore — used via editor.textRunController in keymaps */
  getCodepoints(): number[] {
    return this.#run()
      .glyphs.map((ref) => ref.unicode)
      .filter((unicode): unicode is number => unicode !== null);
  }

  /**
   * Recompute layout and selection rects, then push to the reactive signal.
   * Call after any mutation or cursor movement.
   */
  recompute(originX?: number): void {
    if (!this.#font) {
      this.#$state.set(null);
      return;
    }

    const r = this.#run();
    if (originX !== undefined) {
      r.originX = originX;
    }

    const layout =
      r.glyphs.length > 0
        ? computeTextLayout(r.glyphs, { x: r.originX, y: 0 }, this.#font)
        : { slots: [], totalAdvance: 0 };

    if (r.glyphs.length === 0 && !r.cursorVisible) {
      this.#$state.set(null);
      return;
    }

    const sel = this.selection;
    const metrics = this.#font.getMetrics();
    const selectionRects = sel ? computeSelectionRects(layout.slots, sel, metrics) : [];

    this.#$state.set({
      layout,
      cursorX: r.cursorVisible && !this.hasSelection ? this.#computeCursorX(r, layout) : null,
      selection: sel,
      selectionRects,
      editingIndex: r.editingIndex,
      editingGlyph: r.editingGlyph,
      hoveredIndex: r.hoveredIndex,
      compositeInspection: this.#compositeInspection(r),
    });
  }

  // ── Editing slot ─────────────────────────────────────────────────

  setEditingSlot(index: number | null, glyph: GlyphRef | null = null): void {
    const r = this.#run();
    r.editingIndex = index;
    r.editingGlyph = glyph;
  }

  resetEditingContext(): void {
    const r = this.#run();
    r.editingIndex = null;
    r.editingGlyph = null;
    r.hoveredIndex = null;
    r.inspectionSlotIndex = null;
    r.inspectionHoveredComponentIndex = null;
  }

  // ── Hover / inspection ───────────────────────────────────────────

  setHovered(index: number | null): void {
    const r = this.#run();
    r.hoveredIndex = index;
    if (r.inspectionSlotIndex !== index) {
      r.inspectionHoveredComponentIndex = null;
    }
  }

  setInspectionSlot(index: number | null): void {
    const r = this.#run();
    r.inspectionSlotIndex = index;
    r.inspectionHoveredComponentIndex = null;
  }

  setInspectionHoveredComponent(index: number | null): void {
    const r = this.#run();
    r.inspectionHoveredComponentIndex = r.inspectionSlotIndex === null ? null : index;
  }

  clearInspection(): void {
    const r = this.#run();
    r.inspectionSlotIndex = null;
    r.inspectionHoveredComponentIndex = null;
  }

  // ── Serialization / Persistence ──────────────────────────────────

  snapshot(): TextRunSnapshot {
    const r = this.#run();
    return {
      glyphs: [...r.glyphs],
      cursor: r.cursor,
      anchor: r.anchor,
      originX: r.originX,
      editingIndex: r.editingIndex,
      editingGlyph: r.editingGlyph,
    };
  }

  restore(snapshot: TextRunSnapshot): void {
    const r = this.#run();
    r.glyphs = [...snapshot.glyphs];
    r.cursor = snapshot.cursor;
    r.anchor = snapshot.anchor;
    r.originX = snapshot.originX;
    r.editingIndex = snapshot.editingIndex;
    r.editingGlyph = snapshot.editingGlyph;
  }

  exportRuns(): Record<string, PersistedTextRun> {
    const out: Record<string, PersistedTextRun> = {};
    for (const [key, run] of this.#runs.entries()) {
      if (key === DEFAULT_TEXT_RUN_KEY || run.glyphs.length === 0) continue;
      out[key] = {
        glyphs: [...run.glyphs],
        cursorPosition: run.cursor,
        originX: run.originX,
        editingIndex: run.editingIndex,
        editingGlyph: run.editingGlyph,
      };
    }
    return out;
  }

  hydrateRuns(next: Record<string, PersistedTextRun>): void {
    this.#runs.clear();
    for (const [glyphKey, persisted] of Object.entries(next)) {
      const r = createRunState();
      r.glyphs = [...persisted.glyphs];
      r.cursor = persisted.cursorPosition;
      r.anchor = persisted.cursorPosition;
      r.originX = persisted.originX;
      r.editingIndex = persisted.editingIndex;
      r.editingGlyph = persisted.editingGlyph;
      this.#runs.set(glyphKey, r);
    }

    if (!this.#runs.has(this.#activeKey)) {
      this.#runs.set(this.#activeKey, createRunState());
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  #run(): RunState {
    let r = this.#runs.get(this.#activeKey);
    if (r) return r;
    r = createRunState();
    this.#runs.set(this.#activeKey, r);
    return r;
  }

  #deleteSelectionRange(r: RunState): void {
    if (r.anchor === r.cursor) return;
    const start = Math.min(r.anchor, r.cursor);
    const end = Math.max(r.anchor, r.cursor);
    r.glyphs.splice(start, end - start);
    r.cursor = start;
    r.anchor = start;
  }

  #computeCursorX(r: RunState, layout: TextLayout): number | null {
    if (!r.cursorVisible) return null;

    if (r.cursor === 0) return r.originX;

    if (r.cursor <= layout.slots.length) {
      const prevSlot = layout.slots[r.cursor - 1];
      if (prevSlot) return prevSlot.x + prevSlot.advance;
    }

    return r.originX + layout.totalAdvance;
  }

  #compositeInspection(r: RunState): TextRunCompositeInspection | null {
    if (r.inspectionSlotIndex === null) return null;
    return {
      slotIndex: r.inspectionSlotIndex,
      hoveredComponentIndex: r.inspectionHoveredComponentIndex,
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
