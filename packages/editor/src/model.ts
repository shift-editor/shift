export { Axis } from "./lib/model/Axis";
export { AxisMapping } from "./lib/model/AxisMapping";
export { Font, type GlyphDirectoryPage, type MissingKerningOrigin } from "./lib/model/Font";
export { NamedInstance } from "./lib/model/NamedInstance";
export { Source } from "./lib/model/Source";
export {
  isGroupSide,
  kerningRule,
  kerningValueEdit,
  unkerned,
  kerningSide,
  kerningSideId,
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
export { anchorKind, type AnchorKind } from "./lib/wasm/anchors";
export {
  loadEngine,
  type EditRecording,
  type EditablePair,
  type EngineEdit,
  type EngineKerningPair,
  type EngineLayer,
  type StoreRequest,
  type StoreReply,
  type EngineSession,
  type EngineStage,
  type InterpolatedMetrics,
} from "./lib/wasm/engine";
export { SessionEngine } from "./lib/engine/SessionEngine";
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
