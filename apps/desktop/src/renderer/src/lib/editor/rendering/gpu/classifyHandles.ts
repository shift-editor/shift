import type { Glyph, Point2D, PointId, PointType } from "@shift/types";
import type { HandleState } from "@/types/graphics";
import { Vec2 } from "@shift/geo";
import { Validate } from "@shift/validation";
import { STYLES, type CachedInstanceStyle } from "./handleStyles";
import { GPU_HANDLE_INSTANCE_FLOATS } from "./types";
import { getVisibleSceneBounds } from "../visibleSceneBounds";
import type { ViewportTransform } from "../CanvasCoordinator";

const HANDLE_CULL_MARGIN_PX = 64;

export function packHandleInstances(
  glyph: Glyph,
  getHandleState: (pointId: PointId) => HandleState,
  viewport: ViewportTransform,
  drawOffset: Point2D,
  reusable: Float32Array | null,
): { packedInstances: Float32Array; instanceCount: number } {
  let totalPoints = 0;
  for (const contour of glyph.contours) {
    totalPoints += contour.points.length;
  }

  const requiredLength = totalPoints * GPU_HANDLE_INSTANCE_FLOATS;
  const packed =
    reusable && reusable.length === requiredLength ? reusable : new Float32Array(requiredLength);
  const bounds = getVisibleSceneBounds(viewport, HANDLE_CULL_MARGIN_PX);

  let index = 0;

  for (const contour of glyph.contours) {
    const points = contour.points;
    const numPoints = points.length;
    if (numPoints === 0) continue;

    for (let i = 0; i < numPoints; i++) {
      const point = points[i];
      if (!point) continue;

      const sceneX = point.x + drawOffset.x;
      const sceneY = point.y + drawOffset.y;
      if (
        sceneX < bounds.minX ||
        sceneX > bounds.maxX ||
        sceneY < bounds.minY ||
        sceneY > bounds.maxY
      )
        continue;

      const prev = i > 0 ? points[i - 1] : contour.closed ? points[numPoints - 1] : undefined;
      const next = i + 1 < numPoints ? points[i + 1] : contour.closed ? points[0] : undefined;
      const state = getHandleState(point.id);

      const { style, rotation } = classifyPoint(
        point,
        prev,
        next,
        i,
        numPoints,
        contour.closed,
        state,
      );
      writeInstance(packed, index, point.x, point.y, rotation, style);
      index++;
    }
  }

  return { packedInstances: packed, instanceCount: index };
}

function classifyPoint(
  point: { x: number; y: number; smooth: boolean; pointType: PointType },
  prev: { x: number; y: number } | undefined,
  next: { x: number; y: number } | undefined,
  index: number,
  numPoints: number,
  closed: boolean,
  state: HandleState,
): { style: CachedInstanceStyle; rotation: number } {
  if (numPoints === 1) {
    return { style: STYLES.corner[state], rotation: 0 };
  }

  if (index === 0) {
    const angle = Vec2.angleTo(point, next!);
    const style = closed ? STYLES.direction[state] : STYLES.first[state];
    return { style, rotation: angle };
  }

  if (index === numPoints - 1 && !closed) {
    const angle = Vec2.angleTo(point, prev!) + Math.PI / 2;
    return { style: STYLES.last[state], rotation: angle };
  }

  if (Validate.isOnCurve({ pointType: point.pointType })) {
    const style = point.smooth ? STYLES.smooth[state] : STYLES.corner[state];
    return { style, rotation: 0 };
  }

  return { style: STYLES.control[state], rotation: 0 };
}

function writeInstance(
  packed: Float32Array,
  index: number,
  x: number,
  y: number,
  rotation: number,
  style: CachedInstanceStyle,
): void {
  const base = index * GPU_HANDLE_INSTANCE_FLOATS;
  packed[base] = x;
  packed[base + 1] = y;
  packed[base + 2] = style.extentX;
  packed[base + 3] = style.extentY;
  packed[base + 4] = rotation;
  packed[base + 5] = style.shapeId;
  packed[base + 6] = style.size;
  packed[base + 7] = style.lineWidth;
  packed.set(style.fillColor, base + 8);
  packed.set(style.strokeColor, base + 12);
  packed.set(style.overlayColor, base + 16);
  packed[base + 20] = style.barSize;
  packed.set(style.barStrokeColor, base + 21);
}
