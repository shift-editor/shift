import type { GlyphName, Unicode } from "./generated";

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
  GlyphMaster,
  GlyphName,
  GlyphRecord,
  GlyphState,
  GlyphStructure,
  GlyphVariationData,
  LayerReplaced,
  Location,
  PointData,
  PointSeed,
  PointType,
  Source,
  Unicode,
} from "./generated";

/**
 * Renderer-side glyph address: a name plus optional unicode. This no longer
 * crosses the NAPI boundary (id-addressed `getGlyph` replaced the
 * handle-addressed read), but the renderer still uses it to identify glyphs.
 */
export interface GlyphHandle {
  name: GlyphName;
  unicode?: Unicode;
}
