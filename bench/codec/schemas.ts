// What the generator would emit for the bench's types, as schema data, plus
// one call() per function. Mirrors the layout! types in crates/shift-wasm.
import { bool, call, count, list, names, number, numbers, option, struct } from "./runtime";
import * as bind from "./shim";

export const PointType = names("onCurve", "offCurve", "qCurve");
export const SegmentKind = names("line", "quad", "cubic");
export const SegmentBounds = struct({ minX: number, minY: number, maxX: number, maxY: number });
export const ContourPoints = struct({ closed: bool, pointTypes: list(PointType), coordinates: list(number) });
export const ContourGeometry = struct({
  kinds: list(SegmentKind),
  firsts: list(count),
  segmentBounds: list(number),
  bounds: option(SegmentBounds),
});
export const DecomposedTransform = struct({
  translateX: number,
  translateY: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
  skewX: number,
  skewY: number,
  tCenterX: number,
  tCenterY: number,
});
export const Matrix = struct({ a: number, b: number, c: number, d: number, e: number, f: number });
export const DragFrame = struct({ handle: count, dx: number, dy: number });
export const DragMove = struct({ point: count, x: number, y: number });
/** The plan's drag reply: point, x, y triples as one Float64Array view. */
export const DragMoves = struct({ moves: numbers });
export const KerningRun = struct({
  engine: count,
  source: option(count),
  location: list(number),
  glyphs: list(count),
});

export const contourGeometry = call<unknown, unknown>(bind.contourGeometry, ContourPoints, ContourGeometry);
export const composeTransform = call<unknown, unknown>(bind.composeTransform, DecomposedTransform, Matrix);
export const decomposeMatrix = call<unknown, unknown>(bind.decomposeMatrix, Matrix, DecomposedTransform);
export const dragMoves = call<unknown, unknown[]>(bind.dragMoves, DragFrame, list(DragMove));
export const dragMovesNumbers = call<unknown, { moves: Float64Array }>(bind.dragMoves, DragFrame, DragMoves);
export const engineKerningRun = call<unknown, unknown>(bind.engineKerningRun, KerningRun, option(list(number)));
