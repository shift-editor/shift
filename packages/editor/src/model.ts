export { Font } from "./lib/model/Font";
export { isGroupSide, kerningValueEdit, wireSide } from "./lib/model/Kerning";
export type {
  Kerning,
  KerningPairPosition,
  KerningPairSides,
  KerningSideId,
  ResolvedKerning,
} from "./lib/model/Kerning";
export { FontStore, type GlyphInvalidation } from "./lib/model/FontStore";
export { Glyph, GlyphLayer, GlyphRenderModel } from "./lib/model/Glyph";
export { anchorKind, type AnchorKind } from "./lib/wasm/anchors";
export { GlyphLayerState } from "./lib/model/GlyphLayerState";
export { RenderGlyph } from "./lib/model/RenderGlyph";
export {
  AngleSnap,
  DirectionSnap,
  MetricSnap,
  PointAlignmentSnap,
  PointRuleConstraint,
  PositionEdits,
  PositionReference,
  SnapSet,
} from "./lib/model/positions";

// SPIKE: renderer engine hooks the desktop edit coordinator calls.
export {
  discardRedoInEngine,
  engineAppliedWholeEdit,
  engineDocumentDirty,
  engineWriterEnabled,
  markSavedInEngine,
  persistStatesFor,
  recordEditForUndo,
  stepHistoryInEngine,
} from "./lib/wasm/engine";
