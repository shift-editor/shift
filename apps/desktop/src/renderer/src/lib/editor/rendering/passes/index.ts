export { renderGuides, getGuides, type Guides } from "./guides";
export { renderGlyphOutline, renderGlyphFilled } from "./glyph";
export { renderSegmentHighlights } from "./segments";
export { renderHandles } from "./handles";
export { renderAnchors } from "./anchors";
export {
  renderBoundingRect,
  renderBoundingBoxHandles,
  type BoundingBoxHandlesOptions,
} from "./boundingBox";
export { renderSnapIndicators, collectLineEndpoints } from "./snapIndicators";
export {
  renderDebugTightBounds,
  renderDebugHitRadii,
  renderDebugSegmentBounds,
  renderDebugGlyphBbox,
} from "./debugOverlays";
export { renderTextRun } from "./textRun";
export type { RenderContext } from "./types";
