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

/** Shared contract for an object resolved in the current scene. */
export interface ShiftObjectBase<K extends string, I extends ShiftId> {
  readonly id: I;
  readonly kind: K;

  /** Returns the object's current scene-space bounds. */
  bounds(): Rect2D | null;
}

/** Maps object kind strings to their source-neutral resolved contracts. */
export interface ShiftObjectKindMap {
  readonly node: ShiftObjectBase<"node", NodeId> & {
    readonly node: ShiftNode;
  };

  readonly point: ShiftObjectBase<"point", PointId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly contourId: ContourId;
    readonly pointId: PointId;
  };

  readonly anchor: ShiftObjectBase<"anchor", AnchorId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly anchorId: AnchorId;
  };

  readonly segment: ShiftObjectBase<"segment", SegmentId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly contourId: ContourId;
    readonly segmentId: SegmentId;
    readonly pointIds: readonly PointId[];
  };

  readonly contour: ShiftObjectBase<"contour", ContourId> & {
    readonly node: GlyphNode;
    readonly geometry: GlyphGeometry;
    readonly layer: GlyphLayer | null;
    readonly contourId: ContourId;
  };
}

export type ShiftObjectKind = keyof ShiftObjectKindMap;
export type ShiftObjectOf<K extends ShiftObjectKind> = ShiftObjectKindMap[K];
export type ShiftObject = ShiftObjectKindMap[ShiftObjectKind];

export function objectIsKindOf<K extends ShiftObjectKind>(
  object: ShiftObject | null | undefined,
  kind: K,
): object is ShiftObjectOf<K> {
  return object?.kind === kind;
}
