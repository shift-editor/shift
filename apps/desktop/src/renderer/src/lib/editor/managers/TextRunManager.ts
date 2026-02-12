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

/**
 * Persistent text run state that survives tool switches.
 *
 * Owns the {@link GapBuffer} and exposes computed text run state as a
 * reactive signal for rendering. Lives on the Editor so that switching
 * between text/select/pen tools preserves the typed text.
 */
export class TextRunManager {
  #buffer: GapBuffer;
  #$state: WritableSignal<TextRunState | null>;
  #originX: number = 0;
  #cursorVisible: boolean = false;
  #editingIndex: number | null = null;
  #editingUnicode: number | null = null;
  #hoveredIndex: number | null = null;

  constructor() {
    this.#buffer = GapBuffer.create();
    this.#$state = signal<TextRunState | null>(null);
  }

  get state(): Signal<TextRunState | null> {
    return this.#$state;
  }

  get buffer(): GapBuffer {
    return this.#buffer;
  }

  /**
   * Rebuild layout and cursor position from the current buffer contents.
   * @param font — font data for computing advances and SVG paths.
   * @param originX — optional new horizontal origin in UPM for the text run baseline.
   */
  recompute(font: Font, originX?: number): void {
    if (originX !== undefined) {
      this.#originX = originX;
    }

    const codepoints = this.#buffer.getText();
    const layout =
      codepoints.length > 0
        ? computeTextLayout(codepoints, { x: this.#originX, y: 0 }, font)
        : { slots: [], totalAdvance: 0 };

    // If buffer is empty and cursor isn't visible, clear state entirely
    if (codepoints.length === 0 && !this.#cursorVisible) {
      this.#$state.set(null);
      return;
    }

    const cursorPos = this.#buffer.cursorPosition;

    let cursorX: number | null = null;
    if (this.#cursorVisible) {
      if (cursorPos === 0) {
        cursorX = this.#originX;
      } else if (cursorPos <= layout.slots.length) {
        const prevSlot = layout.slots[cursorPos - 1];
        cursorX = prevSlot.x + prevSlot.advance;
      } else {
        cursorX = this.#originX + layout.totalAdvance;
      }
    }

    this.#$state.set({
      layout,
      editingIndex: this.#editingIndex,
      editingUnicode: this.#editingUnicode,
      hoveredIndex: this.#hoveredIndex,
      cursorX,
    });
  }

  setHovered(index: number | null): void {
    this.#hoveredIndex = index;
    const current = this.#$state.peek();
    if (!current) return;
    this.#$state.set({ ...current, hoveredIndex: index });
  }

  setCursorVisible(visible: boolean): void {
    this.#cursorVisible = visible;
    const current = this.#$state.peek();
    if (!current) return;
    if (!visible) {
      this.#$state.set({ ...current, cursorX: null });
    }
  }

  setEditingSlot(index: number | null, unicode?: number | null): void {
    this.#editingIndex = index;
    this.#editingUnicode = unicode ?? null;
    const current = this.#$state.peek();
    if (!current) return;
    this.#$state.set({
      ...current,
      editingIndex: index,
      editingUnicode: this.#editingUnicode,
    });
  }

  resetEditingContext(): void {
    this.#editingIndex = null;
    this.#editingUnicode = null;
    this.#hoveredIndex = null;
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
    if (unicode === null || this.#buffer.length > 0) return;
    this.#buffer.insert(unicode);
  }

  clear(): void {
    this.#buffer.clear();
    this.#originX = 0;
    this.resetEditingContext();
    this.#cursorVisible = false;
    this.#$state.set(null);
  }
}
