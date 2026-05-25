/**
 * @shift/types - shared DTO and primitive types.
 */

// ID types
export type {
  PointId,
  ContourId,
  AnchorId,
  AxisId,
  ComponentId,
  GuidelineId,
  LayerId,
  SourceId,
} from "./ids";
export {
  asPointId,
  asContourId,
  asAnchorId,
  asAxisId,
  asComponentId,
  asGuidelineId,
  asLayerId,
  asSourceId,
  isValidPointId,
  isValidContourId,
  isValidAnchorId,
  isValidAxisId,
  isValidComponentId,
  isValidGuidelineId,
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
