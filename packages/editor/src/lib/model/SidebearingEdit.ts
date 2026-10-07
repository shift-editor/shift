import { Mat, type DecomposedTransform } from "@shift/geo";
import type { GlyphPosition } from "@shift/glyph-state";
import type { ComponentId } from "@shift/types";
import { batch } from "../signals";
import type { Sidebearing } from "../../types/spacing";
import type { GlyphLayer } from "./Glyph";
import type { GlyphLayerState } from "./GlyphLayerState";

/**
 * One reversible preview and commit cycle that changes one sidebearing of a layer.
 *
 * @remarks
 * `"rsb"` changes the right sidebearing by moving the advance. `"lsb"`
 * changes the left sidebearing by moving every point, anchor, and component
 * and the advance together, so the right sidebearing stays. Previews are
 * evaluated against the state captured at construction. Construction opens
 * the layer's exclusive local-edit slot; finish with {@link commit} or
 * {@link discard}.
 */
export class SidebearingEdit {
  readonly #layer: GlyphLayer;
  readonly #state: GlyphLayerState;
  readonly #sidebearing: Sidebearing;
  readonly #xAdvance: number;
  readonly #positions: readonly GlyphPosition[];
  readonly #componentIds: readonly ComponentId[];
  readonly #transforms: readonly DecomposedTransform[];

  #delta = 0;
  #closed = false;

  /**
   * @param sidebearing - The sidebearing to change.
   * @throws {Error} When the layer already has an active edit.
   */
  constructor(layer: GlyphLayer, state: GlyphLayerState, sidebearing: Sidebearing) {
    const buffers = state.buffers;
    this.#layer = layer;
    this.#state = state;
    this.#sidebearing = sidebearing;
    this.#xAdvance = buffers.xAdvance;
    this.#positions =
      sidebearing === "lsb"
        ? buffers.positionsFor([
            ...layer.allPoints.map((point) => ({ kind: "point" as const, id: point.id })),
            ...layer.anchors.map((anchor) => ({ kind: "anchor" as const, id: anchor.id })),
          ])
        : [];
    this.#componentIds =
      sidebearing === "lsb" ? buffers.components.map((component) => component.data.id) : [];
    this.#transforms = this.#componentIds.map((id) => {
      const transform = buffers.componentTransform(id);
      if (!transform) throw new Error("sidebearing edit lost a component");
      return transform;
    });

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
        if (this.#sidebearing === "lsb") {
          this.#layer.applyPositionPatch(this.#shiftedPositions(delta));
          this.#layer.setComponentTransforms(this.#componentIds, this.#shiftedTransforms(delta));
        }
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
    const delta = this.#delta;
    batch(() => {
      if (this.#sidebearing === "lsb") {
        buffers.patchPositions(this.#shiftedPositions(delta));
        buffers.setComponentTransforms(this.#componentIds, this.#shiftedTransforms(delta));
      }
      buffers.setXAdvance(this.#xAdvance + delta);
    });
  }

  #shiftedPositions(delta: number): GlyphPosition[] {
    return this.#positions.map((position) => ({ ...position, x: position.x + delta }));
  }

  #shiftedTransforms(delta: number): DecomposedTransform[] {
    const shift = Mat.Translate(delta, 0);
    return this.#transforms.map((transform) =>
      Mat.toDecomposed(Mat.Compose(shift, Mat.fromDecomposed(transform))),
    );
  }
}
