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
  mintContourId,
  mintPointId,
} from "./ids";

export type {
  AnchorData,
  AppliedChange,
  Axis,
  AxisTent,
  BridgeApi,
  ComponentData,
  ContourData,
  FontIntent,
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
  LayerReplaced,
  Location,
  PointData,
  PointType,
  Source,
  Unicode,
} from "./bridge";
