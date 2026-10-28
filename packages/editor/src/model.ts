export { Font, type GlyphDirectoryPage, type MissingKerningOrigin } from "./lib/model/Font";
export { sourceMetricValue, withSourceMetricValue } from "./lib/model/sourceMetrics";
export {
  isGroupSide,
  kerningRule,
  kerningValueEdit,
  unkerned,
  wireSide,
} from "./lib/model/Kerning";
export type {
  Kerning,
  KerningPairPosition,
  KerningPairRule,
  KerningPairSides,
  KerningSideId,
  ResolvedKerning,
} from "./lib/model/Kerning";
export { FontStore, type GlyphInvalidation } from "./lib/model/FontStore";
export { Glyph, GlyphLayer, GlyphRenderModel } from "./lib/model/Glyph";
/** An anchor's role in mark positioning, and the kind fontc reads from a name. */
export { anchorKind, type AnchorKind } from "@shift/wasm";
export {
  loadEngine,
  type EditablePair,
  type EngineEdit,
  type EngineKerningPair,
  type EngineLayer,
  type EngineLayerSource,
  type EngineSession,
  type EngineStage,
  type InterpolatedMetrics,
} from "./lib/wasm/engine";
export { GlyphLayerState } from "./lib/model/GlyphLayerState";
export { RenderGlyph } from "./lib/model/RenderGlyph";
export { OutlineTargets } from "./lib/nodes/OutlineTargets";
export { OutlineVisibility } from "./lib/nodes/OutlineVisibility";
export {
  AngleSnap,
  DirectionSnap,
  MetricSnap,
  PointAlignmentSnap,
  PointRuleConstraint,
  PositionEdits,
  PositionReference,
  PositionTargets,
  SnapSet,
} from "./lib/model/positions";
