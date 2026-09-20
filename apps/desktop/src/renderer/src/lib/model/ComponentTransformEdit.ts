import { Mat, type DecomposedTransform, type MatModel } from "@shift/geo";
import type { ComponentId } from "@shift/types";
import type { GlyphLayer } from "./Glyph";
import type { GlyphLayerState } from "./GlyphLayerState";

/**
 * One reversible preview and commit cycle for direct component transforms.
 *
 * @remarks
 * Every preview is evaluated against the transforms captured at construction,
 * so pointer updates do not accumulate numeric drift. Construction opens the
 * layer's exclusive local-edit slot; callers must finish with {@link commit} or
 * {@link discard}.
 */
export class ComponentTransformEdit {
  readonly #glyphLayer: GlyphLayer;
  readonly #state: GlyphLayerState;
  readonly #componentIds: readonly ComponentId[];
  readonly #baseTransforms: readonly DecomposedTransform[];

  #transforms: readonly DecomposedTransform[];
  #closed = false;

  /**
   * Captures the authored transforms and begins local preview ownership.
   *
   * @param glyphLayer - Authored layer whose direct components are changing.
   * @param state - Reactive buffers used for previews and rollback.
   * @param componentIds - Direct component identities transformed as one selection.
   * @throws {Error} When any component is absent or another local edit is active.
   */
  constructor(
    glyphLayer: GlyphLayer,
    state: GlyphLayerState,
    componentIds: readonly ComponentId[],
  ) {
    const uniqueIds = [...new Set(componentIds)];
    const baseTransforms: DecomposedTransform[] = [];
    for (const componentId of uniqueIds) {
      const transform = state.buffers.componentTransform(componentId);
      if (!transform) throw new Error("cannot edit a component outside the active glyph layer");

      baseTransforms.push(transform);
    }

    this.#glyphLayer = glyphLayer;
    this.#state = state;
    this.#componentIds = uniqueIds;
    this.#baseTransforms = baseTransforms;
    this.#transforms = this.#baseTransforms;
    this.#state.beginEdit(() => this.#reapply());
  }

  /** Previews one glyph-local affine delta against the transforms at drag start. */
  preview(delta: MatModel): void {
    this.#assertOpen();
    this.#transforms = this.#baseTransforms.map((transform) =>
      Mat.toDecomposed(Mat.Compose(delta, Mat.fromDecomposed(transform))),
    );
    this.#reapply();
  }

  /** Commits the latest preview as one undoable workspace edit. */
  commit(label: string): void {
    if (this.#closed) return;
    this.#closed = true;

    this.#glyphLayer.transaction(label, () => {
      this.#state.finishEdit(() => {
        this.#glyphLayer.setComponentTransforms(this.#componentIds, this.#transforms);
      });
    });
  }

  /** Restores transforms from before the interaction. */
  discard(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#state.cancelEdit();
  }

  #reapply(): void {
    if (!this.#state.buffers.setComponentTransforms(this.#componentIds, this.#transforms)) {
      throw new Error("cannot reapply component transforms");
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("component transform edit is closed");
  }
}
