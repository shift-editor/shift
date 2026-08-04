import { Bounds, Mat, type MatModel } from "@shift/geo";
import type { DisplayGlyph, DisplayRange } from "@shift/types";
import { Validate } from "@shift/validation";
import { ContourPath } from "@/lib/graphics/ContourPath";
import type {
  GlyphRenderAnchorShape,
  GlyphRenderContourOccurrence,
  GlyphRenderContourShape,
  GlyphRenderInput,
  GlyphRenderPoint,
} from "@/types/glyphRender";
import type { PathCommand } from "@/types/graphics";

/** Adapts one validated retained-source glyph to the existing canvas inputs. */
export class DisplayGlyphRenderModel implements GlyphRenderInput {
  readonly contours: readonly GlyphRenderContourOccurrence[];
  readonly anchors: readonly GlyphRenderAnchorShape[];
  readonly drawPath: Path2D;
  readonly bounds: Bounds | null;
  readonly xAdvance: number;

  constructor(glyph: DisplayGlyph) {
    validatePointArrays(glyph);

    const contours: GlyphRenderContourOccurrence[] = [];
    appendGeometry(glyph, glyph.rootGeometry, Mat.Identity(), true, new Set(), contours);
    this.contours = contours;
    this.anchors = rootAnchors(glyph);
    this.drawPath = combinedPath(contours);
    this.bounds = displayBounds(glyph.bounds);
    this.xAdvance = glyph.xAdvance;
  }
}

function appendGeometry(
  glyph: DisplayGlyph,
  geometryIndex: number,
  transform: MatModel,
  root: boolean,
  visiting: Set<number>,
  output: GlyphRenderContourOccurrence[],
): void {
  if (visiting.has(geometryIndex)) throw new Error("display glyph contains a component cycle");

  const geometry = glyph.geometries[geometryIndex];
  if (!geometry) throw new Error(`display geometry ${geometryIndex} does not exist`);

  visiting.add(geometryIndex);
  for (const contour of rangeItems(glyph.contours, geometry.contours, "contour")) {
    const points = displayPoints(glyph, contour.points, transform);
    const shape: GlyphRenderContourShape = { points, closed: contour.closed };
    const contourPath = ContourPath.fromCommands(pathCommands(shape));
    output.push({
      contour: shape,
      root,
      path: contourPath.path,
      svgPath: contourPath.svgPath,
      bounds: contourPath.bounds,
    });
  }

  for (const component of rangeItems(glyph.components, geometry.components, "component")) {
    const componentTransform = matrix(component.transform);
    appendGeometry(
      glyph,
      component.geometryIndex,
      Mat.Compose(transform, componentTransform),
      false,
      visiting,
      output,
    );
  }
  visiting.delete(geometryIndex);
}

function displayPoints(
  glyph: DisplayGlyph,
  range: DisplayRange,
  transform: MatModel,
): readonly GlyphRenderPoint[] {
  const points: GlyphRenderPoint[] = [];
  const end = checkedEnd(range, glyph.pointKinds.length, "point");
  for (let index = range.start; index < end; index += 1) {
    const coordinateIndex = index * 2;
    const x = glyph.pointCoordinates[coordinateIndex];
    const y = glyph.pointCoordinates[coordinateIndex + 1];
    const kind = glyph.pointKinds[index];
    const smooth = glyph.pointSmooth[index];
    const provenance = glyph.pointProvenance[index];
    if (x === undefined || y === undefined || !kind || smooth === undefined || !provenance) {
      throw new Error(`display point ${index} is incomplete`);
    }

    const position = Mat.applyToPoint(transform, { x, y });
    points.push({
      ...position,
      pointType: kind === "onCurve" ? "onCurve" : "offCurve",
      smooth,
    });
  }
  return points;
}

function pathCommands(contour: GlyphRenderContourShape): readonly PathCommand[] {
  const { points, closed } = contour;
  const first = points[0];
  if (!first) return [];
  if (!Validate.isOnCurve(first)) {
    throw new Error("display contour does not begin on-curve");
  }

  const commands: PathCommand[] = [{ type: "moveTo", x: first.x, y: first.y }];
  const limit = closed ? points.length + 1 : points.length;
  let cursor = 1;
  while (cursor < limit) {
    const point = points[cursor % points.length]!;
    if (Validate.isOnCurve(point)) {
      commands.push({ type: "lineTo", x: point.x, y: point.y });
      cursor += 1;
      continue;
    }

    const end = points[(cursor + 1) % points.length];
    if (!end) throw new Error("display control point has no endpoint");
    const sourceKind = pointKindAt(contour, cursor);
    switch (sourceKind) {
      case "quadraticControl":
        if (!Validate.isOnCurve(end) || cursor + 1 >= limit) {
          throw new Error("display quadratic control has no on-curve endpoint");
        }
        commands.push({
          type: "quadTo",
          cp1x: point.x,
          cp1y: point.y,
          x: end.x,
          y: end.y,
        });
        cursor += 2;
        break;
      case "cubicControl": {
        const cubicEnd = points[(cursor + 2) % points.length];
        if (
          !Validate.isOffCurve(end) ||
          !cubicEnd ||
          !Validate.isOnCurve(cubicEnd) ||
          cursor + 2 >= limit
        ) {
          throw new Error("display cubic controls have no on-curve endpoint");
        }
        commands.push({
          type: "cubicTo",
          cp1x: point.x,
          cp1y: point.y,
          cp2x: end.x,
          cp2y: end.y,
          x: cubicEnd.x,
          y: cubicEnd.y,
        });
        cursor += 3;
        break;
      }
      case "onCurve":
        throw new Error("display point kind disagrees with its point type");
    }
  }

  if (closed) commands.push({ type: "close" });
  return commands;
}

// Canonical source normalization inserts implied quadratic endpoints, so one
// off-curve point is quadratic and two consecutive off-curve points are cubic.
function pointKindAt(
  contour: GlyphRenderContourShape,
  cursor: number,
): "onCurve" | "quadraticControl" | "cubicControl" {
  const current = contour.points[cursor % contour.points.length]!;
  if (Validate.isOnCurve(current)) return "onCurve";
  const next = contour.points[(cursor + 1) % contour.points.length];
  return next && Validate.isOffCurve(next) ? "cubicControl" : "quadraticControl";
}

function rootAnchors(glyph: DisplayGlyph): readonly GlyphRenderAnchorShape[] {
  const root = glyph.geometries[glyph.rootGeometry];
  if (!root) throw new Error(`display root geometry ${glyph.rootGeometry} does not exist`);

  return rangeItems(glyph.anchors, root.anchors, "anchor").map((anchor) => ({
    name: anchor.name,
    x: anchor.x,
    y: anchor.y,
  }));
}

function combinedPath(contours: readonly GlyphRenderContourOccurrence[]): Path2D {
  const path = new Path2D();
  for (const contour of contours) path.addPath(contour.path);
  return path;
}

function displayBounds(values: readonly number[] | undefined): Bounds | null {
  if (!values) return null;
  if (values.length !== 4) throw new Error("display glyph bounds must contain four values");

  return Bounds.create({ x: values[0]!, y: values[1]! }, { x: values[2]!, y: values[3]! });
}

function matrix(values: Float64Array): MatModel {
  if (values.length !== 6) throw new Error("display component transform must contain six values");

  return {
    a: values[0]!,
    b: values[1]!,
    c: values[2]!,
    d: values[3]!,
    e: values[4]!,
    f: values[5]!,
  };
}

function validatePointArrays(glyph: DisplayGlyph): void {
  const pointCount = glyph.pointKinds.length;
  if (
    glyph.pointCoordinates.length !== pointCount * 2 ||
    glyph.pointSmooth.length !== pointCount ||
    glyph.pointProvenance.length !== pointCount ||
    glyph.pointTrueTypeIndices.length !== pointCount
  ) {
    throw new Error("display glyph point arrays have inconsistent lengths");
  }
}

function rangeItems<T>(items: readonly T[], range: DisplayRange, name: string): readonly T[] {
  return items.slice(range.start, checkedEnd(range, items.length, name));
}

function checkedEnd(range: DisplayRange, length: number, name: string): number {
  const end = range.start + range.count;
  if (!Number.isSafeInteger(end) || range.start < 0 || range.count < 0 || end > length) {
    throw new Error(`display ${name} range is out of bounds`);
  }
  return end;
}
