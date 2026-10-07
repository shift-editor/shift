import { Mat } from "@shift/geo";
import { batch } from "../signals";
import type { Sidebearing } from "../../types/spacing";
import type { GlyphLayer } from "./Glyph";
import type { GlyphLayerState } from "./GlyphLayerState";

/**
 * One reversible preview and commit cycle that changes one sidebearing of a layer.
 *
 * @remarks
 * `"rsb"` changes the right sidebearing by moving the advance. `"lsb"`
 * changes the left sidebearing by moving the whole layer (points, anchors,
 * and components) and the advance together, so the right sidebearing stays.
 * Previews restore the layer values captured at construction and apply the
 * same whole-layer transform the commit sends, so preview and result agree.
 * Construction opens the layer's exclusive local-edit slot; finish with
 * {@link commit} or {@link discard}.
 */
export class SidebearingEdit {
  readonly #layer: GlyphLayer;
  readonly #state: GlyphLayerState;
  readonly #sidebearing: Sidebearing;
  readonly #base: Float64Array;
  readonly #xAdvance: number;

  #delta = 0;
  #closed = false;

  /**
   * @param sidebearing - The sidebearing to change.
   * @throws {Error} When the layer already has an active edit.
   */
  constructor(layer: GlyphLayer, state: GlyphLayerState, sidebearing: Sidebearing) {
    this.#layer = layer;
    this.#state = state;
    this.#sidebearing = sidebearing;
    this.#base = state.buffers.snapshot;
    this.#xAdvance = state.buffers.xAdvance;

    state.beginEdit(() => this.#reapply());
  }

  /** Previews the sidebearing changed by `delta` units; positive adds space. */
  preview(delta: number): void {
    if (this.#closed) throw new Error("sidebearing edit is closed");
    this.#delta = delta;
    this.#reapply();
  }

  /** Commits the latest preview as one undo step. */
  commit(label: string): void {
    if (this.#closed) return;
    this.#closed = true;

    const delta = this.#delta;
    if (delta === 0) {
      this.#state.cancelEdit();
      return;
    }

    this.#layer.transaction(label, () => {
      this.#state.finishEdit(() => {
        if (this.#sidebearing === "lsb") this.#layer.transformLayer(Mat.Translate(delta, 0));
        this.#layer.setXAdvance(this.#xAdvance + delta);
      });
    });
  }

  /** Restores the state captured at construction. */
  discard(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#state.cancelEdit();
  }

  #reapply(): void {
    const buffers = this.#state.buffers;
    batch(() => {
      buffers.replaceValues(this.#base);
      if (this.#sidebearing === "lsb") buffers.transformLayer(Mat.Translate(this.#delta, 0));
      buffers.setXAdvance(this.#xAdvance + this.#delta);
    });
  }
}
