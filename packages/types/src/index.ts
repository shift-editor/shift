/**
 * @shift/types - shared DTO and primitive types.
 */

// ID types
export type {
  PointId,
  ContourId,
  AnchorId,
  ComponentId,
  GuidelineId,
  GlyphId,
  LayerId,
  SourceId,
} from "./ids";
export {
  asPointId,
  asContourId,
  asAnchorId,
  asComponentId,
  asGuidelineId,
  asGlyphId,
  asLayerId,
  asSourceId,
  isValidPointId,
  isValidContourId,
  isValidAnchorId,
  isValidComponentId,
  isValidGuidelineId,
  isValidGlyphId,
  isValidLayerId,
  isValidSourceId,
} from "./ids";

export type {
  AnchorData,
  Axis,
  AxisTent,
  BridgeApi,
  ComponentData,
  ContourData,
  FontMetadata,
  FontMetrics,
  GlyphChangedEntities,
  GlyphHandle,
  GlyphLayerRef,
  GlyphMaster,
  GlyphName,
  GlyphRecord,
  GlyphState,
  GlyphStructure,
  GlyphStructureChange,
  GlyphValueChange,
  GlyphVariationData,
  GlyphVariationDiagnostic,
  GlyphVariationDiagnosticSource,
  GlyphVariationReport,
  Location,
  PointData,
  PointType,
  Source,
  Unicode,
} from "./bridge";
