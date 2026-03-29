import type { Glyph, PointId } from "@shift/types";
import type { HandleState } from "@/types/graphics";
import { Vec2 } from "@shift/geo";
import { Validate } from "@shift/validation";
import { HANDLE_STYLES } from "@/lib/styles/style";
import type { BaseHandleStyle } from "@/lib/styles/canvas/handles";
import type { ViewportTransform } from "../CanvasCoordinator";
import {
  GPU_HANDLE_INSTANCE_FLOATS,
  type GpuColour,
  type GpuHandleInstance,
  type GpuHandleShape,
} from "./types";

const TRANSPARENT: GpuColour = [0, 0, 0, 0];
const FIRST_HANDLE_GAP_PX = 3;
const HANDLE_CULL_MARGIN_PX = 64;
const SHAPE_IDS: Record<GpuHandleShape, number> = {
  corner: 0,
  smooth: 1,
  control: 2,
  direction: 3,
  first: 4,
  last: 5,
};

type CachedInstanceStyle = {
  shapeId: number;
  size: number;
  lineWidth: number;
  fillColor: GpuColour;
  strokeColor: GpuColour;
  overlayColor: GpuColour;
  barSize: number;
  barStrokeColor: GpuColour;
  extentX: number;
  extentY: number;
};

const SIMPLE_STYLE_CACHE = {
  corner: createSimpleStyleCacheEntry("corner"),
  smooth: createSimpleStyleCacheEntry("smooth"),
  control: createSimpleStyleCacheEntry("control"),
} as const;

const DIRECTION_STYLE_CACHE = createDirectionalStyleCacheEntry("direction");
const FIRST_STYLE_CACHE = createDirectionalStyleCacheEntry("first");
const LAST_STYLE_CACHE = createDirectionalStyleCacheEntry("last");

export function buildGpuHandleInstances(
  glyph: Glyph,
  getHandleState: (pointId: PointId) => HandleState,
): GpuHandleInstance[] {
  const instances: GpuHandleInstance[] = [];

  for (const contour of glyph.contours) {
    const points = contour.points;
    const numPoints = points.length;
    if (numPoints === 0) continue;

    for (let pointIndex = 0; pointIndex < numPoints; pointIndex += 1) {
      const current = points[pointIndex];
      if (!current) continue;

      const prev =
        pointIndex > 0
          ? points[pointIndex - 1]
          : contour.closed
            ? points[numPoints - 1]
            : undefined;
      const next =
        pointIndex + 1 < numPoints
          ? points[pointIndex + 1]
          : contour.closed
            ? points[0]
            : undefined;
      const state = getHandleState(current.id);
      const position = { x: current.x, y: current.y };

      if (numPoints === 1) {
        instances.push(createSimpleInstance(position, "corner", state));
        continue;
      }

      if (pointIndex === 0) {
        const segmentAngle = Vec2.angleTo(current, next!);
        if (contour.closed) {
          instances.push(createDirectionInstance(position, segmentAngle, state));
        } else {
          instances.push(createFirstInstance(position, segmentAngle, state));
        }
        continue;
      }

      if (pointIndex === numPoints - 1 && !contour.closed) {
        const angle = Vec2.angleTo(position, { x: prev!.x, y: prev!.y }) + Math.PI / 2;
        instances.push(createLastInstance(position, angle, state));
        continue;
      }

      if (Validate.isOnCurve(current)) {
        instances.push(createSimpleInstance(position, current.smooth ? "smooth" : "corner", state));
      } else {
        instances.push(createSimpleInstance(position, "control", state));
      }
    }
  }

  return instances;
}

export function buildPackedGpuHandleInstances(
  glyph: Glyph,
  getHandleState: (pointId: PointId) => HandleState,
  viewport: ViewportTransform,
  drawOffset: { x: number; y: number },
  reusable: Float32Array | null,
): { packedInstances: Float32Array; instanceCount: number } {
  let instanceCount = 0;
  for (const contour of glyph.contours) {
    instanceCount += contour.points.length;
  }

  const requiredLength = instanceCount * GPU_HANDLE_INSTANCE_FLOATS;
  const packed =
    reusable && reusable.length === requiredLength ? reusable : new Float32Array(requiredLength);
  const visibleSceneBounds = getVisibleSceneBounds(viewport);

  let index = 0;
  for (const contour of glyph.contours) {
    const points = contour.points;
    const numPoints = points.length;
    if (numPoints === 0) continue;

    for (let pointIndex = 0; pointIndex < numPoints; pointIndex += 1) {
      const current = points[pointIndex];
      if (!current) continue;

      const prev =
        pointIndex > 0
          ? points[pointIndex - 1]
          : contour.closed
            ? points[numPoints - 1]
            : undefined;
      const next =
        pointIndex + 1 < numPoints
          ? points[pointIndex + 1]
          : contour.closed
            ? points[0]
            : undefined;

      if (!isHandleVisibleInViewport(current.x, current.y, visibleSceneBounds, drawOffset)) {
        continue;
      }

      const state = getHandleState(current.id);

      if (numPoints === 1) {
        writeInstance(packed, index, current.x, current.y, 0, SIMPLE_STYLE_CACHE.corner[state]);
        index += 1;
        continue;
      }

      if (pointIndex === 0) {
        const segmentAngle = Vec2.angleTo(current, next!);
        writeInstance(
          packed,
          index,
          current.x,
          current.y,
          segmentAngle,
          contour.closed ? DIRECTION_STYLE_CACHE[state] : FIRST_STYLE_CACHE[state],
        );
        index += 1;
        continue;
      }

      if (pointIndex === numPoints - 1 && !contour.closed) {
        const angle = Vec2.angleTo(current, prev!) + Math.PI / 2;
        writeInstance(packed, index, current.x, current.y, angle, LAST_STYLE_CACHE[state]);
        index += 1;
        continue;
      }

      if (Validate.isOnCurve(current)) {
        writeInstance(
          packed,
          index,
          current.x,
          current.y,
          0,
          current.smooth ? SIMPLE_STYLE_CACHE.smooth[state] : SIMPLE_STYLE_CACHE.corner[state],
        );
      } else {
        writeInstance(packed, index, current.x, current.y, 0, SIMPLE_STYLE_CACHE.control[state]);
      }
      index += 1;
    }
  }

  return { packedInstances: packed, instanceCount: index };
}

function isHandleVisibleInViewport(
  x: number,
  y: number,
  visibleSceneBounds: { minX: number; maxX: number; minY: number; maxY: number },
  drawOffset: { x: number; y: number },
): boolean {
  const sceneX = x + drawOffset.x;
  const sceneY = y + drawOffset.y;
  return (
    sceneX >= visibleSceneBounds.minX &&
    sceneX <= visibleSceneBounds.maxX &&
    sceneY >= visibleSceneBounds.minY &&
    sceneY <= visibleSceneBounds.maxY
  );
}

function getVisibleSceneBounds(viewport: ViewportTransform): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const logicalWidth = viewport.centre.x * 2;
  const viewTranslateX = viewport.panX + viewport.centre.x * (1 - viewport.zoom);
  const viewTranslateY = viewport.panY + viewport.centre.y * (1 - viewport.zoom);
  const baselineY =
    viewport.logicalHeight - viewport.padding - viewport.descender * viewport.upmScale;
  const zoomedScale = viewport.upmScale * viewport.zoom;
  const minScreenX = -HANDLE_CULL_MARGIN_PX;
  const maxScreenX = logicalWidth + HANDLE_CULL_MARGIN_PX;
  const minScreenY = -HANDLE_CULL_MARGIN_PX;
  const maxScreenY = viewport.logicalHeight + HANDLE_CULL_MARGIN_PX;

  const minX = (minScreenX - viewTranslateX - viewport.padding * viewport.zoom) / zoomedScale;
  const maxX = (maxScreenX - viewTranslateX - viewport.padding * viewport.zoom) / zoomedScale;
  const maxY = (baselineY * viewport.zoom + viewTranslateY - minScreenY) / zoomedScale;
  const minY = (baselineY * viewport.zoom + viewTranslateY - maxScreenY) / zoomedScale;

  return { minX, maxX, minY, maxY };
}

function createSimpleInstance(
  position: { x: number; y: number },
  shape: Extract<GpuHandleShape, "corner" | "smooth" | "control">,
  state: HandleState,
): GpuHandleInstance {
  const style = SIMPLE_STYLE_CACHE[shape][state];

  return {
    position,
    shape,
    shapeId: style.shapeId,
    rotation: 0,
    size: style.size,
    lineWidth: style.lineWidth,
    extent: { x: style.extentX, y: style.extentY },
    fillColor: style.fillColor,
    strokeColor: style.strokeColor,
    overlayColor: style.overlayColor,
    barSize: style.barSize,
    barStrokeColor: style.barStrokeColor,
  };
}

function createDirectionInstance(
  position: { x: number; y: number },
  rotation: number,
  state: HandleState,
): GpuHandleInstance {
  const style = DIRECTION_STYLE_CACHE[state];

  return {
    position,
    shape: "direction",
    shapeId: style.shapeId,
    rotation,
    size: style.size,
    lineWidth: style.lineWidth,
    extent: { x: style.extentX, y: style.extentY },
    fillColor: style.fillColor,
    strokeColor: style.strokeColor,
    overlayColor: style.overlayColor,
    barSize: style.barSize,
    barStrokeColor: style.barStrokeColor,
  };
}

function createFirstInstance(
  position: { x: number; y: number },
  rotation: number,
  state: HandleState,
): GpuHandleInstance {
  const style = FIRST_STYLE_CACHE[state];

  return {
    position,
    shape: "first",
    shapeId: style.shapeId,
    rotation,
    size: style.size,
    lineWidth: style.lineWidth,
    extent: { x: style.extentX, y: style.extentY },
    fillColor: style.fillColor,
    strokeColor: style.strokeColor,
    overlayColor: style.overlayColor,
    barSize: style.barSize,
    barStrokeColor: style.barStrokeColor,
  };
}

function createLastInstance(
  position: { x: number; y: number },
  rotation: number,
  state: HandleState,
): GpuHandleInstance {
  const style = LAST_STYLE_CACHE[state];

  return {
    position,
    shape: "last",
    shapeId: style.shapeId,
    rotation,
    size: style.size,
    lineWidth: style.lineWidth,
    extent: { x: style.extentX, y: style.extentY },
    fillColor: style.fillColor,
    strokeColor: style.strokeColor,
    overlayColor: style.overlayColor,
    barSize: style.size,
    barStrokeColor: style.barStrokeColor,
  };
}

function createSimpleStyleCacheEntry(
  shape: Extract<GpuHandleShape, "corner" | "smooth" | "control">,
): Record<HandleState, CachedInstanceStyle> {
  return {
    idle: createSimpleCachedStyle(shape, "idle"),
    hovered: createSimpleCachedStyle(shape, "hovered"),
    selected: createSimpleCachedStyle(shape, "selected"),
  };
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
  packed[base + 0] = x;
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

function createSimpleCachedStyle(
  shape: Extract<GpuHandleShape, "corner" | "smooth" | "control">,
  state: HandleState,
): CachedInstanceStyle {
  const style = HANDLE_STYLES[shape][state] as BaseHandleStyle;
  const halfSize = shape === "corner" ? style.size / 2 : style.size;
  const padding = Math.max(style.lineWidth, 2);

  return {
    shapeId: SHAPE_IDS[shape],
    size: style.size,
    lineWidth: style.lineWidth,
    fillColor: parseCssColor(style.fillStyle),
    strokeColor: parseCssColor(style.strokeStyle),
    overlayColor: parseCssColor(style.overlayColor),
    barSize: 0,
    barStrokeColor: TRANSPARENT,
    extentX: halfSize + padding,
    extentY: halfSize + padding,
  };
}

function createDirectionalStyleCacheEntry(
  shape: Extract<GpuHandleShape, "direction" | "first" | "last">,
): Record<HandleState, CachedInstanceStyle> {
  return {
    idle: createDirectionalCachedStyle(shape, "idle"),
    hovered: createDirectionalCachedStyle(shape, "hovered"),
    selected: createDirectionalCachedStyle(shape, "selected"),
  };
}

function createDirectionalCachedStyle(
  shape: Extract<GpuHandleShape, "direction" | "first" | "last">,
  state: HandleState,
): CachedInstanceStyle {
  if (shape === "direction") {
    const style = HANDLE_STYLES.direction[state];
    return {
      shapeId: SHAPE_IDS[shape],
      size: style.size,
      lineWidth: style.lineWidth,
      fillColor: parseCssColor(style.fillStyle),
      strokeColor: parseCssColor(style.strokeStyle),
      overlayColor: parseCssColor(style.overlayColor),
      barSize: 0,
      barStrokeColor: TRANSPARENT,
      extentX: style.size + style.lineWidth + 2,
      extentY: style.size + style.lineWidth + 2,
    };
  }

  if (shape === "first") {
    const style = HANDLE_STYLES.first[state] as BaseHandleStyle & {
      barSize: number;
      barStrokeStyle: string;
    };
    const halfBar = style.barSize / 2;
    const triangleTip = FIRST_HANDLE_GAP_PX + style.size * 2;
    return {
      shapeId: SHAPE_IDS[shape],
      size: style.size,
      lineWidth: style.lineWidth,
      fillColor: parseCssColor(style.fillStyle),
      strokeColor: parseCssColor(style.strokeStyle),
      overlayColor: parseCssColor(style.overlayColor),
      barSize: style.barSize,
      barStrokeColor: parseCssColor(style.barStrokeStyle),
      extentX: triangleTip + style.lineWidth + 2,
      extentY: Math.max(halfBar, style.size * 0.866) + style.lineWidth + 2,
    };
  }

  const style = HANDLE_STYLES.last[state];
  return {
    shapeId: SHAPE_IDS[shape],
    size: style.size,
    lineWidth: style.lineWidth,
    fillColor: parseCssColor(style.fillStyle),
    strokeColor: parseCssColor(style.strokeStyle),
    overlayColor: parseCssColor(style.overlayColor),
    barSize: style.size,
    barStrokeColor: parseCssColor(style.strokeStyle),
    extentX: style.size / 2 + style.lineWidth + 2,
    extentY: style.lineWidth + 2,
  };
}

function parseCssColor(input?: string): GpuColour {
  if (!input) return TRANSPARENT;
  const color = input.trim().toLowerCase();

  if (color === "transparent") return TRANSPARENT;
  if (color === "white") return [1, 1, 1, 1];
  if (color === "black") return [0, 0, 0, 1];

  if (color.startsWith("#")) {
    return parseHexColor(color);
  }

  if (color.startsWith("rgba(") || color.startsWith("rgb(")) {
    return parseRgbColor(color);
  }

  return TRANSPARENT;
}

function parseHexColor(hex: string): GpuColour {
  const value = hex.slice(1);
  if (value.length === 3 || value.length === 4) {
    const [r, g, b, a = "f"] = value.split("");
    return [
      Number.parseInt(`${r}${r}`, 16) / 255,
      Number.parseInt(`${g}${g}`, 16) / 255,
      Number.parseInt(`${b}${b}`, 16) / 255,
      Number.parseInt(`${a}${a}`, 16) / 255,
    ];
  }

  if (value.length === 6 || value.length === 8) {
    const alpha = value.length === 8 ? value.slice(6, 8) : "ff";
    return [
      Number.parseInt(value.slice(0, 2), 16) / 255,
      Number.parseInt(value.slice(2, 4), 16) / 255,
      Number.parseInt(value.slice(4, 6), 16) / 255,
      Number.parseInt(alpha, 16) / 255,
    ];
  }

  return TRANSPARENT;
}

function parseRgbColor(input: string): GpuColour {
  const values = input
    .slice(input.indexOf("(") + 1, input.lastIndexOf(")"))
    .split(",")
    .map((value) => value.trim());

  const [r = "0", g = "0", b = "0", a = "1"] = values;
  return [
    clampChannel(Number.parseFloat(r) / 255),
    clampChannel(Number.parseFloat(g) / 255),
    clampChannel(Number.parseFloat(b) / 255),
    clampChannel(Number.parseFloat(a)),
  ];
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
