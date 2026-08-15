import type { AnchorId, ContourId, LayerId, PointId } from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";

export { currentEditingId } from "./editing";
export type {
  GlyphCatalogCanvasProps,
  GlyphCatalogCell,
  GlyphCatalogCellArea,
  GlyphCatalogFrame,
  GlyphCatalogItem,
  GlyphCatalogLayoutMetrics,
  GlyphCatalogSource,
  GlyphNameInputProps,
} from "./glyphCatalog";
export type { EditingId, PendingEditId } from "./editing";
export type { FontOptions, FontStoreOptions } from "./font";
export type { GlyphGeometrySelection, GlyphOptions, GlyphReader } from "./glyph";
export type {
  GlyphAtlasGlyph,
  GlyphAtlasPage,
  GlyphAtlasPageRequest,
  GlyphAtlasPageWeights,
  GlyphAtlasSource,
} from "./glyphAtlas";
export type {
  GlyphRenderAnchor,
  GlyphRenderAnchorInput,
  GlyphRenderContour,
  GlyphRenderContourInput,
} from "./glyphRender";
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
  EditingRecord,
  GlyphNodeRecord,
  SelectionRecord,
  ShiftEditorRecord,
  ShiftNodeRecord,
  ShiftRecord,
  ShiftRecordId,
} from "./records";
export type { TextRunRecord } from "./text";
export type { WorkspaceApplyStatus, WorkspaceEdit } from "./workspace";

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
