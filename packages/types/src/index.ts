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
  LayerId,
  SourceId,
} from "./ids";
export {
  asPointId,
  asContourId,
  asAnchorId,
  asComponentId,
  asGuidelineId,
  asLayerId,
  asSourceId,
  isValidPointId,
  isValidContourId,
  isValidAnchorId,
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
  DocumentMutationResult,
  DocumentPersistResult,
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
  SourceChangeResult,
  SourceCreate,
  SourceUpdate,
  Unicode,
} from "./bridge";
