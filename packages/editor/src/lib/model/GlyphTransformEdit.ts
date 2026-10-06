import { Mat, type DecomposedTransform, type MatModel, type Point2D } from "@shift/geo";
import type { GlyphPosition } from "@shift/glyph-state";
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

interface GlyphTransformResult {
  readonly positions: readonly GlyphPosition[];
  readonly transforms: readonly DecomposedTransform[];
  readonly xAdvance: number;
}

/**
 * One reversible preview and commit cycle that transforms a whole glyph layer.
 *
 * @remarks
 * Moves every point, anchor, and component, except components whose base
 * glyph is transformed alongside: they already follow it, and moving them too
 * would apply the transform twice. Deltas arrive in the placing frame's units
 * and reach the glyph's own units through `origin`. With
 * `keepRightSidebearing`, the outline lands exactly where the delta puts it
 * and the advance follows its right edge, so the right sidebearing survives a
 * scale; otherwise the advance never changes. Every preview is evaluated against the
 * state captured at construction. Construction opens the layer's exclusive
 * local-edit slot; finish with {@link commit} or {@link discard}.
 */
export class GlyphTransformEdit {
  readonly #layer: GlyphLayer;
  readonly #state: GlyphLayerState;
  readonly #origin: Point2D;
  readonly #keepRightSidebearing: boolean;
  readonly #base: GlyphTransformResult;
  readonly #componentIds: readonly ComponentId[];
  /** The outline's left and right edges at construction, or null without an outline. */
  readonly #edges: { readonly left: number; readonly right: number } | null;

  #result: GlyphTransformResult;
  #closed = false;

  /** @throws {Error} When the layer already has an active edit. */
  constructor(layer: GlyphLayer, state: GlyphLayerState, options: GlyphTransformOptions) {
    const buffers = state.buffers;
    this.#componentIds = buffers.components
      .filter((component) => !options.transformedGlyphIds.has(component.data.baseGlyphId))
      .map((component) => component.data.id);
    this.#base = {
      positions: buffers.positionsFor([
        ...layer.allPoints.map((point) => ({ kind: "point" as const, id: point.id })),
        ...layer.anchors.map((anchor) => ({ kind: "anchor" as const, id: anchor.id })),
      ]),
      transforms: this.#componentIds.map((id) => {
        const transform = buffers.componentTransform(id);
        if (!transform) throw new Error("glyph transform lost a component");
        return transform;
      }),
      xAdvance: buffers.xAdvance,
    };
    const { lsb, rsb } = buffers.sidebearings;
    this.#edges =
      lsb === null || rsb === null ? null : { left: lsb, right: buffers.xAdvance - rsb };
    this.#layer = layer;
    this.#state = state;
    this.#origin = options.origin;
    this.#keepRightSidebearing = options.keepRightSidebearing;
    this.#result = this.#base;

    state.beginEdit(() => this.#reapply());
  }

  /** Previews `delta`, given in the placing frame's units. */
  preview(delta: MatModel): void {
    this.#assertOpen();
    this.#result = this.#transformed(delta);
    this.#reapply();
  }

  /** Commits the latest preview; joins the caller's transaction when there is one. */
  commit(): void {
    if (this.#closed) return;
    this.#closed = true;

    const result = this.#result;
    this.#layer.transaction("Transform glyph", () => {
      this.#state.finishEdit(() => {
        this.#layer.applyPositionPatch(result.positions);
        this.#layer.setComponentTransforms(this.#componentIds, result.transforms);
        if (result.xAdvance !== this.#base.xAdvance) this.#layer.setXAdvance(result.xAdvance);
      });
    });
  }

  /** Restores the state captured at construction. */
  discard(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#state.cancelEdit();
  }

  #transformed(delta: MatModel): GlyphTransformResult {
    const origin = this.#origin;
    const matrix = Mat.Compose(
      Mat.Translate(-origin.x, -origin.y),
      Mat.Compose(delta, Mat.Translate(origin.x, origin.y)),
    );
    let xAdvance = this.#base.xAdvance;

    const edges = this.#edges;
    if (this.#keepRightSidebearing && edges) {
      const left = Mat.applyToPoint(matrix, { x: edges.left, y: 0 }).x;
      const right = Mat.applyToPoint(matrix, { x: edges.right, y: 0 }).x;
      xAdvance = Math.max(left, right) + (xAdvance - edges.right);
    }

    return {
      positions: this.#base.positions.map((position) => ({
        ...position,
        ...Mat.applyToPoint(matrix, position),
      })),
      transforms: this.#base.transforms.map((transform) =>
        Mat.toDecomposed(Mat.Compose(matrix, Mat.fromDecomposed(transform))),
      ),
      xAdvance,
    };
  }

  #reapply(): void {
    const buffers = this.#state.buffers;
    batch(() => {
      buffers.patchPositions(this.#result.positions);
      if (!buffers.setComponentTransforms(this.#componentIds, this.#result.transforms)) {
        throw new Error("cannot reapply glyph component transforms");
      }
      buffers.setXAdvance(this.#result.xAdvance);
    });
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("glyph transform edit is closed");
  }
}
