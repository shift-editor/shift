/**
 * TextRunController — reactive text buffer with cursor, selection, and layout.
 *
 * All state is immutable signals. Mutations replace the state value.
 * The render state is a computed that derives layout, selection rects,
 * and cursor position from the buffer state — zero manual recompute calls.
 *
 * Selection uses the anchor/focus model (same as DOM Selection API):
 * - anchor: where the selection started (stays put during shift+arrow)
 * - focus:  where the caret is (moves during shift+arrow)
 * - when anchor === focus, there is no selection (just a caret)
 */
import {
  signal,
  computed,
  type Signal,
  type WritableSignal,
  type ComputedSignal,
} from "@/lib/reactive/signal";
import { computeTextLayout, type GlyphRef, type GlyphSlot, type TextLayout } from "./layout";
import type { Font } from "@/lib/editor/Font";
import type { FontMetrics } from "@shift/types";

export interface SelectionRange {
  start: number;
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
  cursorY: number;
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

export interface PersistedTextRun {
  glyphs: GlyphRef[];
  cursorPosition: number;
  originX: number;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
}

const DEFAULT_TEXT_RUN_KEY = "__default__";

interface RunState {
  readonly glyphs: readonly GlyphRef[];
  readonly cursor: number;
  readonly anchor: number;
  readonly originX: number;
  readonly cursorVisible: boolean;
  readonly editingIndex: number | null;
  readonly editingGlyph: GlyphRef | null;
  readonly hoveredIndex: number | null;
  readonly inspectionSlotIndex: number | null;
  readonly inspectionHoveredComponentIndex: number | null;
}

const EMPTY_RUN: RunState = {
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

export class TextRunController {
  #runs = new Map<string, WritableSignal<RunState>>();
  #$activeKey: WritableSignal<string>;
  #$font: WritableSignal<Font | null>;

  #$state: ComputedSignal<TextRunRenderState | null>;

  constructor() {
    this.#$activeKey = signal(DEFAULT_TEXT_RUN_KEY);
    this.#$font = signal<Font | null>(null);
    this.#$state = computed(() => this.#deriveRenderState());
  }

  get state(): Signal<TextRunRenderState | null> {
    return this.#$state;
  }

  get length(): number {
    return this.#peek().glyphs.length;
  }

  get cursor(): number {
    return this.#peek().cursor;
  }

  get anchor(): number {
    return this.#peek().anchor;
  }

  get hasSelection(): boolean {
    const r = this.#peek();
    return r.anchor !== r.cursor;
  }

  get selection(): SelectionRange | null {
    const r = this.#peek();
    if (r.anchor === r.cursor) return null;
    return {
      start: Math.min(r.anchor, r.cursor),
      end: Math.max(r.anchor, r.cursor),
    };
  }

  get glyphs(): readonly GlyphRef[] {
    return this.#peek().glyphs;
  }

  get selectedGlyphs(): GlyphRef[] {
    const sel = this.selection;
    if (!sel) return [];
    return this.#peek().glyphs.slice(sel.start, sel.end);
  }

  moveCursorLeft(extend = false): void {
    this.#update((r) => {
      if (!extend && r.anchor !== r.cursor) {
        const start = Math.min(r.anchor, r.cursor);
        return { ...r, cursor: start, anchor: start };
      }

      const cursor = Math.max(0, r.cursor - 1);
      return { ...r, cursor, anchor: extend ? r.anchor : cursor };
    });
  }

  moveCursorRight(extend = false): void {
    this.#update((r) => {
      if (!extend && r.anchor !== r.cursor) {
        const end = Math.max(r.anchor, r.cursor);
        return { ...r, cursor: end, anchor: end };
      }

      const cursor = Math.min(r.glyphs.length, r.cursor + 1);
      return { ...r, cursor, anchor: extend ? r.anchor : cursor };
    });
  }

  moveCursorToStart(extend = false): void {
    this.#update((r) => ({ ...r, cursor: 0, anchor: extend ? r.anchor : 0 }));
  }

  moveCursorToEnd(extend = false): void {
    this.#update((r) => ({
      ...r,
      cursor: r.glyphs.length,
      anchor: extend ? r.anchor : r.glyphs.length,
    }));
  }

  selectAll(): void {
    this.#update((r) => ({ ...r, anchor: 0, cursor: r.glyphs.length }));
  }

  selectRange(start: number, end: number): void {
    this.#update((r) => ({
      ...r,
      anchor: Math.max(0, Math.min(start, r.glyphs.length)),
      cursor: Math.max(0, Math.min(end, r.glyphs.length)),
    }));
  }

  collapseSelection(to: "start" | "end" = "end"): void {
    this.#update((r) => {
      if (r.anchor === r.cursor) return r;
      const pos = to === "start" ? Math.min(r.anchor, r.cursor) : Math.max(r.anchor, r.cursor);
      return { ...r, cursor: pos, anchor: pos };
    });
  }

  placeCaret(index: number): void {
    this.#update((r) => {
      const clamped = Math.max(0, Math.min(index, r.glyphs.length));
      return { ...r, cursor: clamped, anchor: clamped };
    });
  }

  extendSelection(index: number): void {
    this.#update((r) => ({
      ...r,
      cursor: Math.max(0, Math.min(index, r.glyphs.length)),
    }));
  }

  insert(glyph: GlyphRef): void {
    this.#update((r) => {
      const { glyphs, cursor } = deleteRange(r);
      const next = [...glyphs];
      next.splice(cursor, 0, glyph);
      return { ...r, glyphs: next, cursor: cursor + 1, anchor: cursor + 1 };
    });
  }

  insertAt(index: number, glyph: GlyphRef): void {
    this.#update((r) => {
      const clamped = Math.max(0, Math.min(index, r.glyphs.length));
      const next = [...r.glyphs];
      next.splice(clamped, 0, glyph);
      return {
        ...r,
        glyphs: next,
        cursor: r.cursor >= clamped ? r.cursor + 1 : r.cursor,
        anchor: r.anchor >= clamped ? r.anchor + 1 : r.anchor,
      };
    });
  }

  insertMany(glyphs: GlyphRef[]): void {
    this.#update((r) => {
      const { glyphs: current, cursor } = deleteRange(r);
      const next = [...current];
      next.splice(cursor, 0, ...glyphs);
      return { ...r, glyphs: next, cursor: cursor + glyphs.length, anchor: cursor + glyphs.length };
    });
  }

  delete(): boolean {
    const r = this.#peek();

    if (r.anchor !== r.cursor) {
      this.#update((r) => {
        const { glyphs, cursor } = deleteRange(r);
        return { ...r, glyphs, cursor, anchor: cursor };
      });
      return true;
    }

    if (r.cursor === 0) return false;

    this.#update((r) => {
      const next = [...r.glyphs];
      next.splice(r.cursor - 1, 1);
      return { ...r, glyphs: next, cursor: r.cursor - 1, anchor: r.cursor - 1 };
    });
    return true;
  }

  deleteForward(): boolean {
    const r = this.#peek();

    if (r.anchor !== r.cursor) {
      this.#update((r) => {
        const { glyphs, cursor } = deleteRange(r);
        return { ...r, glyphs, cursor, anchor: cursor };
      });
      return true;
    }

    if (r.cursor >= r.glyphs.length) return false;

    this.#update((r) => {
      const next = [...r.glyphs];
      next.splice(r.cursor, 1);
      return { ...r, glyphs: next };
    });
    return true;
  }

  seed(glyph: GlyphRef): void {
    const r = this.#peek();
    if (r.glyphs.length > 0) return;
    this.#set({ ...r, glyphs: [glyph], cursor: 1, anchor: 1 });
  }

  clear(): void {
    this.#set(EMPTY_RUN);
  }

  clearAll(): void {
    this.#runs.clear();
  }

  setFont(font: Font): void {
    this.#$font.set(font);
  }

  setOriginX(x: number): void {
    this.#update((r) => ({ ...r, originX: x }));
  }

  setCursorVisible(visible: boolean): void {
    this.#update((r) => ({ ...r, cursorVisible: visible }));
  }

  /** @knipclassignore — used via editor.textRunController in HiddenTextInput */
  getCodepoints(): number[] {
    return this.#peek()
      .glyphs.map((ref) => ref.unicode)
      .filter((unicode): unicode is number => unicode !== null);
  }

  setOwnerGlyph(glyph: GlyphRef | null): void {
    const nextKey = glyph ? glyph.glyphName : DEFAULT_TEXT_RUN_KEY;
    if (nextKey === this.#$activeKey.peek()) return;
    this.#$activeKey.set(nextKey);
    this.#update((r) => ({
      ...r,
      hoveredIndex: null,
      inspectionSlotIndex: null,
      inspectionHoveredComponentIndex: null,
    }));
  }

  setEditingSlot(index: number | null, glyph: GlyphRef | null = null): void {
    this.#update((r) => ({ ...r, editingIndex: index, editingGlyph: glyph }));
  }

  resetEditingContext(): void {
    this.#update((r) => ({
      ...r,
      editingIndex: null,
      editingGlyph: null,
      hoveredIndex: null,
      inspectionSlotIndex: null,
      inspectionHoveredComponentIndex: null,
    }));
  }

  setHovered(index: number | null): void {
    this.#update((r) => ({
      ...r,
      hoveredIndex: index,
      inspectionHoveredComponentIndex:
        r.inspectionSlotIndex !== index ? null : r.inspectionHoveredComponentIndex,
    }));
  }

  setInspectionSlot(index: number | null): void {
    this.#update((r) => ({
      ...r,
      inspectionSlotIndex: index,
      inspectionHoveredComponentIndex: null,
    }));
  }

  setInspectionHoveredComponent(index: number | null): void {
    this.#update((r) => ({
      ...r,
      inspectionHoveredComponentIndex: r.inspectionSlotIndex === null ? null : index,
    }));
  }

  clearInspection(): void {
    this.#update((r) => ({
      ...r,
      inspectionSlotIndex: null,
      inspectionHoveredComponentIndex: null,
    }));
  }

  snapshot(): TextRunSnapshot {
    const r = this.#peek();
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
    this.#set({
      ...this.#peek(),
      glyphs: [...snapshot.glyphs],
      cursor: snapshot.cursor,
      anchor: snapshot.anchor,
      originX: snapshot.originX,
      editingIndex: snapshot.editingIndex,
      editingGlyph: snapshot.editingGlyph,
    });
  }

  exportRuns(): Record<string, PersistedTextRun> {
    const out: Record<string, PersistedTextRun> = {};
    for (const [key, $run] of this.#runs.entries()) {
      if (key === DEFAULT_TEXT_RUN_KEY) continue;
      const run = $run.peek();
      if (run.glyphs.length === 0) continue;
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
      this.#runs.set(
        glyphKey,
        signal<RunState>({
          ...EMPTY_RUN,
          glyphs: [...persisted.glyphs],
          cursor: persisted.cursorPosition,
          anchor: persisted.cursorPosition,
          originX: persisted.originX,
          editingIndex: persisted.editingIndex,
          editingGlyph: persisted.editingGlyph,
        }),
      );
    }

    const key = this.#$activeKey.peek();
    if (!this.#runs.has(key)) {
      this.#runs.set(key, signal<RunState>(EMPTY_RUN));
    }
  }

  #signal(): WritableSignal<RunState> {
    const key = this.#$activeKey.peek();
    let $r = this.#runs.get(key);
    if ($r) return $r;
    $r = signal<RunState>(EMPTY_RUN);
    this.#runs.set(key, $r);
    return $r;
  }

  #peek(): RunState {
    const key = this.#$activeKey.peek();
    const $r = this.#runs.get(key);
    return $r ? $r.peek() : EMPTY_RUN;
  }

  #set(next: RunState): void {
    this.#signal().set(next);
  }

  #update(fn: (current: RunState) => RunState): void {
    const $r = this.#signal();
    const next = fn($r.peek());
    $r.set(next);
  }

  #deriveRenderState(): TextRunRenderState | null {
    this.#$activeKey.value; // track active key changes
    const r = this.#signal().value; // track run state changes (creates signal if needed)
    const font = this.#$font.value; // track font changes
    if (!font) return null;

    const layout =
      r.glyphs.length > 0
        ? computeTextLayout([...r.glyphs], { x: r.originX, y: 0 }, font)
        : { slots: [], totalAdvance: 0 };

    if (r.glyphs.length === 0 && !r.cursorVisible) return null;

    const sel =
      r.anchor !== r.cursor
        ? { start: Math.min(r.anchor, r.cursor), end: Math.max(r.anchor, r.cursor) }
        : null;
    const metrics = font.getMetrics();
    const selectionRects = sel ? computeSelectionRects(layout.slots, sel, metrics) : [];

    const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);
    const cursorPos = r.cursorVisible && !sel ? computeCursorPosition(r, layout, lineHeight) : null;

    const compositeInspection =
      r.inspectionSlotIndex !== null
        ? {
            slotIndex: r.inspectionSlotIndex,
            hoveredComponentIndex: r.inspectionHoveredComponentIndex,
          }
        : null;

    return {
      layout,
      cursorX: cursorPos?.x ?? null,
      cursorY: cursorPos?.y ?? 0,
      selection: sel,
      selectionRects,
      editingIndex: r.editingIndex,
      editingGlyph: r.editingGlyph,
      hoveredIndex: r.hoveredIndex,
      compositeInspection,
    };
  }
}

function deleteRange(r: RunState): { glyphs: GlyphRef[]; cursor: number } {
  if (r.anchor === r.cursor) return { glyphs: [...r.glyphs], cursor: r.cursor };
  const start = Math.min(r.anchor, r.cursor);
  const end = Math.max(r.anchor, r.cursor);
  const glyphs = [...r.glyphs];
  glyphs.splice(start, end - start);
  return { glyphs, cursor: start };
}

function computeCursorPosition(
  r: RunState,
  layout: TextLayout,
  lineHeight: number,
): { x: number; y: number } | null {
  if (!r.cursorVisible) return null;

  if (r.cursor === 0) {
    const firstSlot = layout.slots[0];
    return { x: r.originX, y: firstSlot?.y ?? 0 };
  }

  if (r.cursor <= layout.slots.length) {
    const prevSlot = layout.slots[r.cursor - 1];
    if (!prevSlot) return { x: r.originX, y: 0 };

    if (prevSlot.unicode === 10) {
      return { x: r.originX, y: prevSlot.y - lineHeight };
    }

    return { x: prevSlot.x + prevSlot.advance, y: prevSlot.y };
  }

  const lastSlot = layout.slots[layout.slots.length - 1];
  if (!lastSlot) return { x: r.originX, y: 0 };

  if (lastSlot.unicode === 10) {
    return { x: r.originX, y: lastSlot.y - lineHeight };
  }

  return { x: lastSlot.x + lastSlot.advance, y: lastSlot.y };
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
      top: slot.y + metrics.ascender,
      bottom: slot.y + metrics.descender,
    });
  }

  return mergeAdjacentRects(rects);
}

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
