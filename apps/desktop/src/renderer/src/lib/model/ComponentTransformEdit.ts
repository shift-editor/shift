import { Mat, type DecomposedTransform, type MatModel } from "@shift/geo";
import { batch } from "@/lib/signals";
import type {
  ComponentTransformSelection,
  ComponentTransformSelectionLayer,
} from "@/types/componentTransform";
import type { GlyphLayerState } from "./GlyphLayerState";

/**
 * One reversible preview and commit cycle for matched direct component transforms.
 *
 * @remarks
 * Every preview is evaluated against the transforms captured at construction,
 * so pointer updates do not accumulate numeric drift. Construction opens each
 * participating layer's exclusive local-edit slot; callers must finish with
 * {@link commit} or {@link discard}.
 */
export class ComponentTransformEdit {
  readonly #layers: readonly ComponentTransformSelectionLayer[];
  readonly #states: readonly GlyphLayerState[];
  readonly #baseTransforms: readonly (readonly DecomposedTransform[])[];

  #transforms: readonly (readonly DecomposedTransform[])[];
  #closed = false;

  /**
   * Captures every matched layer's authored transforms and begins preview ownership.
   *
   * @param selection - Frozen reference and matched component selections.
   * @param states - Reactive layer states in the same order as the selection layers.
   * @throws {Error} When a component is absent, state alignment is invalid, or another edit is active.
   */
  constructor(selection: ComponentTransformSelection, states: readonly GlyphLayerState[]) {
    const layers = [selection, ...selection.additionalLayers];
    if (states.length !== layers.length) {
      throw new Error("component transform states must match the selected layers");
    }

    const baseTransforms = layers.map((layer, index) => {
      const state = states[index];
      if (!state) throw new Error("component transform state is missing");

      return layer.componentIds.map((componentId) => {
        const transform = state.buffers.componentTransform(componentId);
        if (!transform) throw new Error("cannot edit a component outside its selected layer");

        return transform;
      });
    });

    this.#layers = layers;
    this.#states = states;
    this.#baseTransforms = baseTransforms;
    this.#transforms = baseTransforms;

    const started: GlyphLayerState[] = [];
    try {
      for (let index = 0; index < states.length; index++) {
        const state = states[index];
        if (!state) continue;

        state.beginEdit(() => this.#reapply(index));
        started.push(state);
      }
    } catch (error) {
      for (const state of started) state.cancelEdit();
      throw error;
    }
  }

  /**
   * Previews one affine delta per source against the transforms at drag start.
   *
   * @param deltaForLayer - Returns the glyph-local delta for one frozen source selection.
   */
  preview(deltaForLayer: (layer: ComponentTransformSelectionLayer) => MatModel): void {
    this.#assertOpen();
    this.#transforms = this.#layers.map((layer, index) => {
      const delta = deltaForLayer(layer);
      return (this.#baseTransforms[index] ?? []).map((transform) =>
        Mat.toDecomposed(Mat.Compose(delta, Mat.fromDecomposed(transform))),
      );
    });

    batch(() => {
      for (let index = 0; index < this.#layers.length; index++) this.#reapply(index);
    });
  }

  /** Commits every source's latest preview as one undoable workspace edit. */
  commit(label: string): void {
    if (this.#closed) return;
    this.#closed = true;

    const reference = this.#layers[0];
    if (!reference) return;

    reference.layer.transaction(label, () => {
      batch(() => {
        for (let index = 0; index < this.#layers.length; index++) {
          const layer = this.#layers[index];
          const state = this.#states[index];
          const transforms = this.#transforms[index];
          if (!layer || !state || !transforms) continue;

          state.finishEdit(() => {
            layer.layer.setComponentTransforms(layer.componentIds, transforms);
          });
        }
      });
    });
  }

  /** Restores every participating source to its accepted transforms. */
  discard(): void {
    if (this.#closed) return;
    this.#closed = true;

    batch(() => {
      for (const state of this.#states) state.cancelEdit();
    });
  }

  #reapply(index: number): void {
    const layer = this.#layers[index];
    const state = this.#states[index];
    const transforms = this.#transforms[index];
    if (!layer || !state || !transforms) return;

    if (!state.buffers.setComponentTransforms(layer.componentIds, transforms)) {
      throw new Error("cannot reapply component transforms");
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("component transform edit is closed");
  }
}
