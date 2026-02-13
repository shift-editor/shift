import { signal, type Signal, type WritableSignal } from "@/lib/reactive/signal";
import { GapBuffer } from "@/lib/tools/text/GapBuffer";
import { computeTextLayout, type TextLayout } from "@/lib/tools/text/layout";
import type { Font } from "../Font";

/**
 * State of the text run, consumed by the text run render pass.
 *
 * - `layout` — slot positions computed from the gap buffer contents.
 * - `editingIndex` — the slot index of the glyph being edited in-place
 *   (skipped during text run rendering, rendered by the normal glyph pipeline).
 * - `editingUnicode` — unicode of the in-place glyph.
 * - `hoveredIndex` — hover highlight index (select mode).
 * - `cursorX` — horizontal cursor position in UPM; null when cursor hidden.
 */
export interface TextRunState {
  layout: TextLayout;
  editingIndex: number | null;
  editingUnicode: number | null;
  hoveredIndex: number | null;
  cursorX: number | null;
}

export interface PersistedTextRun {
  codepoints: number[];
  cursorPosition: number;
  originX: number;
  editingIndex: number | null;
  editingUnicode: number | null;
}

const DEFAULT_RUN_KEY = "__default__";

interface TextRunEntry {
  buffer: GapBuffer;
  originX: number;
  cursorVisible: boolean;
  editingIndex: number | null;
  editingUnicode: number | null;
  hoveredIndex: number | null;
}

/**
 * Persistent text run state that survives tool switches.
 *
 * Owns the {@link GapBuffer} and exposes computed text run state as a
 * reactive signal for rendering. Lives on the Editor so that switching
 * between text/select/pen tools preserves the typed text.
 */
export class TextRunManager {
  #$state: WritableSignal<TextRunState | null>;
  #runs: Map<string, TextRunEntry>;
  #activeKey: string;
  #font: Font | null = null;

  constructor() {
    this.#$state = signal<TextRunState | null>(null);
    this.#runs = new Map();
    this.#activeKey = DEFAULT_RUN_KEY;
  }

  get state(): Signal<TextRunState | null> {
    return this.#$state;
  }

  get buffer(): GapBuffer {
    return this.#activeRun().buffer;
  }

  setOwnerGlyph(unicode: number | null): void {
    const nextKey = this.#glyphKey(unicode);
    if (nextKey === this.#activeKey) return;

    this.#activeKey = nextKey;
    const run = this.#activeRun();
    run.hoveredIndex = null;

    if (this.#font) {
      this.recompute(this.#font);
      return;
    }

    this.#$state.set(null);
  }

  /**
   * Rebuild layout and cursor position from the current buffer contents.
   * @param font — font data for computing advances and SVG paths.
   * @param originX — optional new horizontal origin in UPM for the text run baseline.
   */
  recompute(font: Font, originX?: number): void {
    this.#font = font;
    const run = this.#activeRun();
    if (originX !== undefined) {
      run.originX = originX;
    }

    const codepoints = run.buffer.getText();
    const layout =
      codepoints.length > 0
        ? computeTextLayout(codepoints, { x: run.originX, y: 0 }, font)
        : { slots: [], totalAdvance: 0 };

    // If buffer is empty and cursor isn't visible, clear state entirely
    if (codepoints.length === 0 && !run.cursorVisible) {
      this.#$state.set(null);
      return;
    }

    const cursorPos = run.buffer.cursorPosition;

    let cursorX: number | null = null;
    if (run.cursorVisible) {
      if (cursorPos === 0) {
        cursorX = run.originX;
      } else if (cursorPos <= layout.slots.length) {
        const prevSlot = layout.slots[cursorPos - 1];
        cursorX = prevSlot.x + prevSlot.advance;
      } else {
        cursorX = run.originX + layout.totalAdvance;
      }
    }

    this.#$state.set({
      layout,
      editingIndex: run.editingIndex,
      editingUnicode: run.editingUnicode,
      hoveredIndex: run.hoveredIndex,
      cursorX,
    });
  }

  setHovered(index: number | null): void {
    const run = this.#activeRun();
    run.hoveredIndex = index;
    const current = this.#$state.peek();
    if (!current) return;
    this.#$state.set({ ...current, hoveredIndex: index });
  }

  setCursorVisible(visible: boolean): void {
    const run = this.#activeRun();
    run.cursorVisible = visible;
    const current = this.#$state.peek();
    if (!current) return;
    if (!visible) {
      this.#$state.set({ ...current, cursorX: null });
    }
  }

  setEditingSlot(index: number | null, unicode?: number | null): void {
    const run = this.#activeRun();
    run.editingIndex = index;
    run.editingUnicode = unicode ?? null;
    const current = this.#$state.peek();
    if (!current) return;
    this.#$state.set({
      ...current,
      editingIndex: index,
      editingUnicode: run.editingUnicode,
    });
  }

  resetEditingContext(): void {
    const run = this.#activeRun();
    run.editingIndex = null;
    run.editingUnicode = null;
    run.hoveredIndex = null;
    const current = this.#$state.peek();
    if (!current) return;
    this.#$state.set({
      ...current,
      editingIndex: null,
      editingUnicode: null,
      hoveredIndex: null,
    });
  }

  ensureSeeded(unicode: number | null): void {
    const run = this.#activeRun();
    if (unicode === null || run.buffer.length > 0) return;
    run.buffer.insert(unicode);
  }

  clear(): void {
    const run = this.#activeRun();
    run.buffer.clear();
    run.originX = 0;
    run.editingIndex = null;
    run.editingUnicode = null;
    run.hoveredIndex = null;
    run.cursorVisible = false;
    this.#$state.set(null);
  }

  clearAll(): void {
    this.#runs.clear();
    this.#$state.set(null);
  }

  exportRuns(): Record<string, PersistedTextRun> {
    const out: Record<string, PersistedTextRun> = {};
    for (const [key, run] of this.#runs.entries()) {
      if (key === DEFAULT_RUN_KEY || run.buffer.length === 0) continue;
      out[key] = {
        codepoints: run.buffer.getText(),
        cursorPosition: run.buffer.cursorPosition,
        originX: run.originX,
        editingIndex: run.editingIndex,
        editingUnicode: run.editingUnicode,
      };
    }
    return out;
  }

  hydrateRuns(next: Record<string, PersistedTextRun>): void {
    this.#runs.clear();

    for (const [glyphKey, run] of Object.entries(next)) {
      this.#runs.set(glyphKey, {
        buffer: GapBuffer.from(run.codepoints ?? [], run.cursorPosition),
        originX: Number.isFinite(run.originX) ? run.originX : 0,
        cursorVisible: false,
        editingIndex: run.editingIndex ?? null,
        editingUnicode: run.editingUnicode ?? null,
        hoveredIndex: null,
      });
    }

    if (!this.#runs.has(this.#activeKey)) {
      this.#runs.set(this.#activeKey, this.#createRun());
    }

    if (this.#font) {
      this.recompute(this.#font);
      return;
    }
    this.#$state.set(null);
  }

  #glyphKey(unicode: number | null): string {
    if (unicode === null) return DEFAULT_RUN_KEY;
    return String(unicode);
  }

  #activeRun(): TextRunEntry {
    let run = this.#runs.get(this.#activeKey);
    if (run) return run;
    run = this.#createRun();
    this.#runs.set(this.#activeKey, run);
    return run;
  }

  #createRun(): TextRunEntry {
    return {
      buffer: GapBuffer.create(),
      originX: 0,
      cursorVisible: false,
      editingIndex: null,
      editingUnicode: null,
      hoveredIndex: null,
    };
  }
}
