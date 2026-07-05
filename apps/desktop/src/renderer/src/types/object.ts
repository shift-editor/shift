import type { Rect2D } from "@shift/geo";
import type { SegmentId } from "@shift/glyph-state";
import type { AnchorId, ContourId, NodeId, PointId } from "@shift/types";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { GlyphNode, ShiftNode } from "./node";

declare const SelectionIdBrand: unique symbol;

export type SelectionId = string & { readonly [SelectionIdBrand]: typeof SelectionIdBrand };

export const currentSelectionId = "selection:current" as SelectionId;

/** Identifies an editor-addressable scene node or authored glyph object. */
export type ShiftId = NodeId | PointId | AnchorId | ContourId | SegmentId;

/** Identifies objects that can be selected by the editor. */
export type SelectableId = ShiftId;

/**
 * Defines the shared contract for a resolved editor object.
 *
 * @remarks
 * Resolved objects combine a stable ID, a discriminating kind, and enough live
 * ownership or placement context to answer object-level behavior without
 * callers passing editor plumbing into each method.
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
 * Maps object kind strings to their resolved object interfaces.
 *
 * @remarks
 * Built-in kinds live here. Compiled extensions can augment this interface so
 * `objectIsKindOf(object, kind)` narrows plugin-defined object kinds too.
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
   * Represents an editable glyph point resolved through its layer and scene node.
   *
   * @remarks
   * The point's coordinates should be read from `layer` when behavior runs. This
   * object carries `node` so glyph-local geometry can be interpreted in scene
   * coordinates without restoring editor-global glyph state.
   */
  readonly point: ShiftObjectBase<"point", PointId> & {
    readonly node: GlyphNode;
    readonly layer: GlyphLayer;
    readonly pointId: PointId;
  };

  /**
   * Represents a glyph anchor resolved through its layer and scene node.
   *
   * @remarks
   * Anchors are glyph-internal objects, not scene nodes. The paired glyph node
   * supplies placement when rendering indicators or computing scene-space bounds.
   */
  readonly anchor: ShiftObjectBase<"anchor", AnchorId> & {
    readonly node: GlyphNode;
    readonly layer: GlyphLayer;
    readonly anchorId: AnchorId;
  };

  /**
   * Represents a glyph segment resolved through its layer and endpoint IDs.
   *
   * @remarks
   * Segment IDs are derived geometry identities. `pointIds` records the endpoint
   * ownership needed for operations that expand a selected segment to its points
   * without changing selection semantics.
   */
  readonly segment: ShiftObjectBase<"segment", SegmentId> & {
    readonly node: GlyphNode;
    readonly layer: GlyphLayer;
    readonly segmentId: SegmentId;
    readonly pointIds: readonly PointId[];
  };

  /**
   * Represents a glyph contour resolved through its layer and scene node.
   *
   * @remarks
   * Contours are authored glyph structure. Bounds and content behavior should use
   * the current layer structure rather than cached contour objects.
   */
  readonly contour: ShiftObjectBase<"contour", ContourId> & {
    readonly node: GlyphNode;
    readonly layer: GlyphLayer;
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
