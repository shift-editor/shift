export { Anchor, type AnchorHit } from "./Anchor";
export { Component, type Matrix } from "./Component";
export { composeTransform, decomposeMatrix } from "./generated/geometryLayouts";
export { Contour } from "./Contour";
export { IdIndex } from "./IdIndex";
export { decomposedTransformValues, readDecomposedTransform } from "./valueLayout";
export { Point, type NewPoint, type PointHit, type PointWithNeighbors } from "./Point";
export type { ContourGeometry, SegmentedContour } from "./types/contour";
export {
  segmentContour,
  type ContourSegment,
  type SegmentedContourGeometry,
} from "./segmentContour";
export { filledContoursContain } from "./filledContoursContain";
export {
  GlyphGeometry,
  type GeometryAnchorHit,
  type GeometryHit,
  type GeometryPointHit,
  type GeometrySegmentHit,
  type GlyphAnchorHit,
  type GlyphHit,
  type GlyphHitKind,
  type GlyphPointHit,
  type GlyphPosition,
  type GlyphPositions,
  type GlyphPositionTarget,
  type GlyphSegmentHit,
  type GlyphSidebearings,
} from "./GlyphGeometry";
export {
  Segment,
  isSegmentId,
  parseSegmentId,
  segmentIdFor,
  type SegmentHit,
  type SegmentType,
  type SegmentPoints,
  type LineSegmentPoints,
  type QuadSegmentPoints,
  type CubicSegmentPoints,
  type LineSegment,
  type QuadSegment,
  type CubicSegment,
} from "./Segment";
