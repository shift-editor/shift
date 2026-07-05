import type { AnchorId, ContourId, LayerId, PointId } from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";

export { currentSelectionId, objectIsKindOf } from "./object";
export type {
  SelectableId,
  SelectionId,
  ShiftId,
  ShiftObject,
  ShiftObjectBase,
  ShiftObjectKind,
  ShiftObjectKindMap,
  ShiftObjectOf,
} from "./object";
export type {
  GlyphNodeRecord,
  SelectionRecord,
  ShiftEditorRecord,
  ShiftNodeRecord,
  ShiftRecord,
  ShiftRecordId,
} from "./records";

export interface GlyphObjectSegment {
  readonly id: SegmentId;
  readonly pointIds: readonly PointId[];
}

export interface GlyphObjectIndex {
  readonly layerIdByPointId: ReadonlyMap<PointId, LayerId>;
  readonly contourIdByPointId: ReadonlyMap<PointId, ContourId>;
  readonly layerIdByContourId: ReadonlyMap<ContourId, LayerId>;
  readonly layerIdByAnchorId: ReadonlyMap<AnchorId, LayerId>;
  readonly layerIdBySegmentId: ReadonlyMap<SegmentId, LayerId>;
  readonly contourIdBySegmentId: ReadonlyMap<SegmentId, ContourId>;
  readonly pointIdsBySegmentId: ReadonlyMap<SegmentId, readonly PointId[]>;
}
