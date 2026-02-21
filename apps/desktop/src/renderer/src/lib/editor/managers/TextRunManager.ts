import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";
import { computeTextLayout, type TextLayout, type GlyphRef } from "@/lib/tools/text/layout";
import type { Font } from "../Font";
import {
  createTextRunEntry,
  DEFAULT_TEXT_RUN_KEY,
  hydrateTextRuns,
  serializeTextRuns,
  type PersistedTextRun,
  type TextRunEntry,
} from "./textRunPersistence";
export type { PersistedTextRun } from "./textRunPersistence";

export interface TextRunCompositeInspection {
  slotIndex: number;
  hoveredComponentIndex: number | null;
}

/**
 * State of the text run, consumed by the text run render pass.
 */
export interface TextRunState {
  layout: TextLayout;
  editingIndex: number | null;
  editingGlyph: GlyphRef | null;
  hoveredIndex: number | null;
  compositeInspection: TextRunCompositeInspection | null;
  cursorX: number | null;
}

/**
 * Persistent text run state that survives tool switches.
 */
export class TextRunManager {
  #$state: WritableSignal<TextRunState | null>;
  #runs: Map<string, TextRunEntry>;
  #activeKey: string;
  #font: Font | null = null;

  constructor() {
    this.#$state = signal<TextRunState | null>(null);
    this.#runs = new Map();
    this.#activeKey = DEFAULT_TEXT_RUN_KEY;
  }

  get state(): Signal<TextRunState | null> {
    return this.#$state;
  }

  get buffer(): TextRunEntry["buffer"] {
    return this.#activeRun().buffer;
  }

  setOwnerGlyph(glyph: GlyphRef | null): void {
    const nextKey = this.#glyphKey(glyph);
    if (nextKey === this.#activeKey) return;

    this.#activeKey = nextKey;
    const run = this.#activeRun();
    run.hoveredIndex = null;
    run.inspectionSlotIndex = null;
    run.inspectionHoveredComponentIndex = null;

    if (!this.#font) {
      this.#$state.set(null);
      return;
    }

    this.recompute(this.#font);
  }

  recompute(font: Font, originX?: number): void {
    this.#font = font;
    const run = this.#activeRun();
    if (originX !== undefined) {
      run.originX = originX;
    }

    const glyphs = run.buffer.getText();
    const layout =
      glyphs.length > 0
        ? computeTextLayout(glyphs, { x: run.originX, y: 0 }, font)
        : { slots: [], totalAdvance: 0 };

    if (glyphs.length === 0 && !run.cursorVisible) {
      this.#$state.set(null);
      return;
    }

    this.#$state.set({
      layout,
      editingIndex: run.editingIndex,
      editingGlyph: run.editingGlyph,
      hoveredIndex: run.hoveredIndex,
      compositeInspection: toCompositeInspection(run),
      cursorX: this.#computeCursorX(run, layout),
    });
  }

  setHovered(index: number | null): void {
    const run = this.#activeRun();
    run.hoveredIndex = index;
    if (run.inspectionSlotIndex !== index) {
      run.inspectionHoveredComponentIndex = null;
    }
    this.#syncState((current) => ({
      ...current,
      hoveredIndex: index,
      compositeInspection: toCompositeInspection(run),
    }));
  }

  setInspectionSlot(index: number | null): void {
    const run = this.#activeRun();
    run.inspectionSlotIndex = index;
    run.inspectionHoveredComponentIndex = null;
    this.#syncState((current) => ({
      ...current,
      compositeInspection: toCompositeInspection(run),
    }));
  }

  setInspectionHoveredComponent(index: number | null): void {
    const run = this.#activeRun();
    run.inspectionHoveredComponentIndex = run.inspectionSlotIndex === null ? null : index;
    this.#syncState((current) => ({
      ...current,
      compositeInspection: toCompositeInspection(run),
    }));
  }

  clearInspection(): void {
    const run = this.#activeRun();
    run.inspectionSlotIndex = null;
    run.inspectionHoveredComponentIndex = null;
    this.#syncState((current) => ({
      ...current,
      compositeInspection: null,
    }));
  }

  setCursorVisible(visible: boolean): void {
    const run = this.#activeRun();
    run.cursorVisible = visible;
    if (!visible) {
      this.#syncState((current) => ({ ...current, cursorX: null }));
    }
  }

  setEditingSlot(index: number | null, glyph: GlyphRef | null = null): void {
    const run = this.#activeRun();
    run.editingIndex = index;
    run.editingGlyph = glyph;
    this.#syncState((current) => ({
      ...current,
      editingIndex: index,
      editingGlyph: glyph,
    }));
  }

  resetEditingContext(): void {
    const run = this.#activeRun();
    run.editingIndex = null;
    run.editingGlyph = null;
    run.hoveredIndex = null;
    run.inspectionSlotIndex = null;
    run.inspectionHoveredComponentIndex = null;
    this.#syncState((current) => ({
      ...current,
      editingIndex: null,
      editingGlyph: null,
      hoveredIndex: null,
      compositeInspection: null,
    }));
  }

  ensureSeeded(glyph: GlyphRef | null): void {
    const run = this.#activeRun();
    if (run.buffer.length > 0 || glyph === null) return;
    run.buffer.insert(glyph);
  }

  insertGlyphAt(index: number, glyph: GlyphRef): void {
    const run = this.#activeRun();
    run.buffer.moveTo(index);
    run.buffer.insert(glyph);
  }

  clear(): void {
    const run = this.#activeRun();
    run.buffer.clear();
    run.originX = 0;
    run.editingIndex = null;
    run.editingGlyph = null;
    run.hoveredIndex = null;
    run.inspectionSlotIndex = null;
    run.inspectionHoveredComponentIndex = null;
    run.cursorVisible = false;
    this.#$state.set(null);
  }

  clearAll(): void {
    this.#runs.clear();
    this.#$state.set(null);
  }

  exportRuns(): Record<string, PersistedTextRun> {
    return serializeTextRuns(this.#runs, DEFAULT_TEXT_RUN_KEY);
  }

  hydrateRuns(next: Record<string, PersistedTextRun>): void {
    this.#runs = hydrateTextRuns(next);
    if (!this.#runs.has(this.#activeKey)) {
      this.#runs.set(this.#activeKey, createTextRunEntry());
    }

    if (!this.#font) {
      this.#$state.set(null);
      return;
    }

    this.recompute(this.#font);
  }

  #syncState(update: (current: TextRunState) => TextRunState): void {
    const current = this.#$state.peek();
    if (!current) return;
    this.#$state.set(update(current));
  }

  #computeCursorX(run: TextRunEntry, layout: TextLayout): number | null {
    if (!run.cursorVisible) return null;

    const cursorPos = run.buffer.cursorPosition;
    if (cursorPos === 0) {
      return run.originX;
    }

    if (cursorPos <= layout.slots.length) {
      const prevSlot = layout.slots[cursorPos - 1];
      if (prevSlot) {
        return prevSlot.x + prevSlot.advance;
      }
    }

    return run.originX + layout.totalAdvance;
  }

  #glyphKey(glyph: GlyphRef | null): string {
    if (!glyph) return DEFAULT_TEXT_RUN_KEY;
    return glyph.glyphName;
  }

  #activeRun(): TextRunEntry {
    let run = this.#runs.get(this.#activeKey);
    if (run) return run;

    run = createTextRunEntry();
    this.#runs.set(this.#activeKey, run);
    return run;
  }
}

function toCompositeInspection(run: TextRunEntry): TextRunCompositeInspection | null {
  if (run.inspectionSlotIndex === null) {
    return null;
  }

  return {
    slotIndex: run.inspectionSlotIndex,
    hoveredComponentIndex: run.inspectionHoveredComponentIndex,
  };
}
