import { Mat, type DecomposedTransform, type MatModel, type Point2D } from "@shift/geo";
import type { ComponentId, GlyphId } from "@shift/types";
import { batch } from "../signals";
import type { GlyphLayer } from "./Glyph";
import type { GlyphLayerState } from "./GlyphLayerState";

/** How {@link GlyphTransformEdit} places and spaces one glyph. */
export interface GlyphTransformOptions {
  /** Where the glyph's origin sits in the units deltas are given in. */
  readonly origin: Point2D;
  /** Whether the advance follows the outline's right edge, keeping the right sidebearing. */
  readonly keepRightSidebearing: boolean;
  /** Glyphs transformed in the same edit; components built on them follow them instead. */
  readonly transformedGlyphIds: ReadonlySet<GlyphId>;
}

/**
 * One reversible preview and commit cycle that transforms a whole glyph layer.
 *
 * @remarks
 * Applies one whole-layer transform (`transformLayer`) to every point, anchor,
 * and component, then puts back components whose base glyph is transformed
 * alongside: they already follow it, and moving them too would apply the
 * transform twice. Deltas arrive in the placing frame's units and reach the
 * glyph's own units through `origin`. With `keepRightSidebearing`, the outline
 * lands exactly where the delta puts it and the advance follows its right
 * edge, so the right sidebearing survives a scale; otherwise the advance never
 * changes. Previews restore the layer values captured at construction and
 * apply the same transform the commit sends, so preview and result agree.
 * Construction opens the layer's exclusive local-edit slot; finish with
 * {@link commit} or {@link discard}.
 */
export class GlyphTransformEdit {
  readonly #layer: GlyphLayer;
  readonly #state: GlyphLayerState;
  readonly #origin: Point2D;
  readonly #keepRightSidebearing: boolean;
  readonly #base: Float64Array;
  readonly #xAdvance: number;
  /** Components that follow a transformed base glyph, with the placement they keep. */
  readonly #followerIds: readonly ComponentId[];
  readonly #followerTransforms: readonly DecomposedTransform[];
  /** The outline's left and right edges at construction, or null without an outline. */
  readonly #edges: { readonly left: number; readonly right: number } | null;

  #matrix: MatModel | null = null;
  #closed = false;

  /** @throws {Error} When the layer already has an active edit. */
  constructor(layer: GlyphLayer, state: GlyphLayerState, options: GlyphTransformOptions) {
    const buffers = state.buffers;
    const followers = buffers.components.filter((component) =>
      options.transformedGlyphIds.has(component.data.baseGlyphId),
    );
    const { lsb, rsb } = buffers.sidebearings;

    this.#layer = layer;
    this.#state = state;
    this.#origin = options.origin;
    this.#keepRightSidebearing = options.keepRightSidebearing;
    this.#base = buffers.snapshot;
    this.#xAdvance = buffers.xAdvance;
    this.#followerIds = followers.map((component) => component.data.id);
    this.#followerTransforms = followers.map((component) => component.transform);
    this.#edges =
      lsb === null || rsb === null ? null : { left: lsb, right: buffers.xAdvance - rsb };

    state.beginEdit(() => this.#reapply());
  }

  /** Previews `delta`, given in the placing frame's units. */
  preview(delta: MatModel): void {
    if (this.#closed) throw new Error("glyph transform edit is closed");
    const origin = this.#origin;
    this.#matrix = Mat.Compose(
      Mat.Translate(-origin.x, -origin.y),
      Mat.Compose(delta, Mat.Translate(origin.x, origin.y)),
    );
    this.#reapply();
  }

  /** Commits the latest preview; joins the caller's transaction when there is one. */
  commit(): void {
    if (this.#closed) return;
    this.#closed = true;

    const matrix = this.#matrix;
    if (!matrix) {
      this.#state.cancelEdit();
      return;
    }

    const xAdvance = this.#xAdvanceFor(matrix);
    this.#layer.transaction("Transform glyph", () => {
      this.#state.finishEdit(() => {
        this.#layer.transformLayer(matrix);
        if (this.#followerIds.length > 0) {
          this.#layer.setComponentTransforms(this.#followerIds, this.#followerTransforms);
        }
        if (xAdvance !== this.#xAdvance) this.#layer.setXAdvance(xAdvance);
      });
    });
  }

  /** Restores the state captured at construction. */
  discard(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#state.cancelEdit();
  }

  #xAdvanceFor(matrix: MatModel): number {
    const edges = this.#edges;
    if (!this.#keepRightSidebearing || !edges) return this.#xAdvance;

    const left = Mat.applyToPoint(matrix, { x: edges.left, y: 0 }).x;
    const right = Mat.applyToPoint(matrix, { x: edges.right, y: 0 }).x;
    return Math.max(left, right) + (this.#xAdvance - edges.right);
  }

  #reapply(): void {
    const matrix = this.#matrix;
    const buffers = this.#state.buffers;
    batch(() => {
      buffers.replaceValues(this.#base);
      if (!matrix) return;

      buffers.transformLayer(matrix);
      if (!buffers.setComponentTransforms(this.#followerIds, this.#followerTransforms)) {
        throw new Error("cannot reapply glyph component transforms");
      }
      buffers.setXAdvance(this.#xAdvanceFor(matrix));
    });
  }
}
