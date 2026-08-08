import type { Rect2D } from "@shift/geo";
import type { GlyphGeometry, SegmentId } from "@shift/glyph-state";
import type { AnchorId, ContourId, NodeId, PointId } from "@shift/types";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { GlyphNode, ShiftNode } from "./node";

declare const SelectionIdBrand: unique symbol;

export type SelectionId = string & { readonly [SelectionIdBrand]: typeof SelectionIdBrand };

export const currentSelectionId = "selection:current" as SelectionId;

/** Identifies an editor-addressable scene node or glyph object. */
export type ShiftId = NodeId | PointId | AnchorId | ContourId | SegmentId;

/** Identifies objects that can be selected by the editor. */
export type SelectableId = ShiftId;

/**
 * Defines the shared contract for a resolved editor object.
 *
 * @remarks
 * Resolved objects combine stable identity, a discriminating kind, and live
 * scene placement. Glyph objects also carry displayed geometry independently
 * from whether an authored layer is available.
 *
 * @template K - Kind string used for discriminated narrowing.
 * @template I - Stable identity for this object.
 */
export interface ShiftObjectBase<K extends string, I extends ShiftId> {
  /** Stable identity used to address this object. */
  readonly id: I;

  /** Discriminant used to narrow this object to its concrete interface. */
  readonly kind: K;

  /**
   * Returns this object's current scene-space bounds.
   *
   * @returns null when the object has no bounds or its backing model is unavailable.
   */
  bounds(): Rect2D | null;
}

/**
 * Maps object kind strings to their source-neutral resolved object interfaces.
 *
 * @remarks
 * Built-in kinds live here. Compiled extensions can augment this interface so
 * `objectIsKindOf(object, kind)` narrows plugin-defined object kinds too.
 * Displayed geometry is always available for glyph objects. `layer` is present
 * only when the object has an exact authored owner and therefore represents
 * edit capability rather than display identity.
 */
export interface ShiftObjectKindMap {
  /**
   * Represents a placed scene node resolved from a node ID.
   *
   * @remarks
   * The node is scene placement data. Kind-specific canonical data still belongs
   * to the node's owning subsystem, such as the font for glyph nodes or future
   * asset storage for image nodes.
   */
  readonly node: ShiftObjectBase<"node", NodeId> & {
    readonly node: ShiftNode;
  };

  /**
   * Represents a glyph point resolved through displayed geometry and its scene node.
   *
   * @remarks
   * Read coordinates from `geometry`. Single-object mutations use `layer` when
   * non-null; imported or interpolated points remain addressable but immutable.
   */
  readonly point: ShiftObjectBase<"point", PointId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly contourId: ContourId;
    readonly pointId: PointId;
  };

  /**
   * Represents a glyph anchor resolved through displayed geometry and its scene node.
   *
   * @remarks
   * The paired glyph node supplies scene placement. A non-null `layer` identifies
   * the exact authored owner available for mutation.
   */
  readonly anchor: ShiftObjectBase<"anchor", AnchorId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly anchorId: AnchorId;
  };

  /**
   * Represents a glyph segment resolved through displayed geometry and endpoint IDs.
   *
   * @remarks
   * Segment IDs are derived geometry identities. `pointIds` records the endpoint
   * ownership needed to expand a segment operation without changing selection
   * semantics. Mutation requires a non-null `layer`.
   */
  readonly segment: ShiftObjectBase<"segment", SegmentId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly contourId: ContourId;
    readonly segmentId: SegmentId;
    readonly pointIds: readonly PointId[];
  };

  /**
   * Represents a glyph contour resolved through displayed geometry and its scene node.
   *
   * @remarks
   * Bounds and read behavior use `geometry`. Authored mutations require the
   * optional `layer` capability rather than inferring ownership from identity.
   */
  readonly contour: ShiftObjectBase<"contour", ContourId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly contourId: ContourId;
  };
}

/** Names the resolved object kinds known to this build. */
export type ShiftObjectKind = keyof ShiftObjectKindMap;

/** Returns the resolved object contract for one kind. */
export type ShiftObjectOf<K extends ShiftObjectKind> = ShiftObjectKindMap[K];

/** Represents any resolved editor object known to this build. */
export type ShiftObject = ShiftObjectKindMap[ShiftObjectKind];

/**
 * Narrows a resolved object to one registered kind.
 *
 * @param object - Candidate object; nullish values fail the guard.
 * @param kind - Kind string to test against the object's discriminant.
 * @returns true when the object exists and has the requested kind.
 */
export function objectIsKindOf<K extends ShiftObjectKind>(
  object: ShiftObject | null | undefined,
  kind: K,
): object is ShiftObjectOf<K> {
  return object?.kind === kind;
}
