import type { Point2D } from "@shift/types";
import type { Canvas } from "../Canvas";
import type { HandleState, HandleType } from "@/types/graphics";
import type { HandleStyle } from "../Theme";
import { Vec2 } from "@shift/geo";

const START_TRIANGLE_GAP = 3;

export function drawHandle(
  canvas: Canvas,
  point: Point2D,
  type: Exclude<HandleType, "first" | "last" | "direction">,
  state: HandleState,
): void {
  const style = canvas.theme.handle[type][state];

  switch (type) {
    case "corner":
      drawCorner(canvas, point, style);
      break;
    case "anchor":
      drawDiamond(canvas, point, style);
      break;
    case "control":
    case "smooth":
      drawCircleHandle(canvas, point, style);
      break;
  }
}

export function drawHandleFirst(
  canvas: Canvas,
  point: Point2D,
  angle: number,
  state: HandleState,
): void {
  const style = canvas.theme.handle.first[state];
  const sizeUpm = canvas.pxToUpm(style.size);
  const barSizeUpm = canvas.pxToUpm(style.barSize);
  const lineWidthUpm = canvas.pxToUpm(style.lineWidth);
  const gapUpm = canvas.pxToUpm(START_TRIANGLE_GAP);

  canvas.ctx.save();
  canvas.ctx.lineWidth = lineWidthUpm;

  // Draw bar
  const perpAngle = angle + Math.PI / 2;
  canvas.ctx.strokeStyle = style.barStroke;
  drawHorizontalLine(canvas.ctx, point.x, point.y, barSizeUpm, perpAngle);

  // Draw triangle
  canvas.ctx.fillStyle = style.fill;
  canvas.ctx.strokeStyle = style.stroke;
  const direction = Vec2.fromAngle(angle);
  const triangleOffset = Vec2.scale(direction, gapUpm + sizeUpm);
  const trianglePos = Vec2.add(point, triangleOffset);
  drawTriangle(canvas.ctx, trianglePos.x, trianglePos.y, sizeUpm, angle);

  if (style.overlayColor) {
    canvas.ctx.strokeStyle = style.overlayColor;
    drawHorizontalLine(canvas.ctx, point.x, point.y, barSizeUpm, perpAngle);
    canvas.ctx.fillStyle = style.overlayColor;
    drawTriangle(canvas.ctx, trianglePos.x, trianglePos.y, sizeUpm, angle);
  }

  canvas.ctx.restore();
}

export function drawHandleDirection(
  canvas: Canvas,
  point: Point2D,
  angle: number,
  state: HandleState,
): void {
  const style = canvas.theme.handle.direction[state];
  const sizeUpm = canvas.pxToUpm(style.size);
  const lineWidthUpm = canvas.pxToUpm(style.lineWidth);

  canvas.ctx.save();
  canvas.ctx.lineWidth = lineWidthUpm;
  canvas.ctx.fillStyle = style.fill;
  canvas.ctx.strokeStyle = style.stroke;
  drawTriangle(canvas.ctx, point.x, point.y, sizeUpm, angle);

  if (style.overlayColor) {
    canvas.ctx.fillStyle = style.overlayColor;
    canvas.ctx.strokeStyle = style.overlayColor;
    drawTriangle(canvas.ctx, point.x, point.y, sizeUpm, angle);
  }

  canvas.ctx.restore();
}

export function drawHandleLast(
  canvas: Canvas,
  anchor: Point2D,
  prev: Point2D,
  state: HandleState,
): void {
  const style = canvas.theme.handle.last[state];
  const sizeUpm = canvas.pxToUpm(style.size);
  const lineWidthUpm = canvas.pxToUpm(style.lineWidth);

  canvas.ctx.save();
  canvas.ctx.lineWidth = lineWidthUpm;
  canvas.ctx.fillStyle = style.fill;
  canvas.ctx.strokeStyle = style.stroke;

  const angle = Vec2.angleTo(anchor, prev);
  const perpAngle = angle + Math.PI / 2;
  drawHorizontalLine(canvas.ctx, anchor.x, anchor.y, sizeUpm, perpAngle);

  if (style.overlayColor) {
    canvas.ctx.fillStyle = style.overlayColor;
    canvas.ctx.strokeStyle = style.overlayColor;
    drawHorizontalLine(canvas.ctx, anchor.x, anchor.y, sizeUpm, perpAngle);
  }

  canvas.ctx.restore();
}

function drawCorner(canvas: Canvas, point: Point2D, style: HandleStyle): void {
  const sizeUpm = canvas.pxToUpm(style.size);
  const half = sizeUpm / 2;

  canvas.ctx.save();
  canvas.ctx.lineWidth = canvas.pxToUpm(style.lineWidth);
  canvas.ctx.fillStyle = style.fill;
  canvas.ctx.strokeStyle = style.stroke;
  canvas.ctx.fillRect(point.x - half, point.y - half, sizeUpm, sizeUpm);
  canvas.ctx.strokeRect(point.x - half, point.y - half, sizeUpm, sizeUpm);

  if (style.overlayColor) {
    canvas.ctx.fillStyle = style.overlayColor;
    canvas.ctx.strokeStyle = style.overlayColor;
    canvas.ctx.fillRect(point.x - half, point.y - half, sizeUpm, sizeUpm);
    canvas.ctx.strokeRect(point.x - half, point.y - half, sizeUpm, sizeUpm);
  }

  canvas.ctx.restore();
}

function drawCircleHandle(canvas: Canvas, point: Point2D, style: HandleStyle): void {
  const radiusUpm = canvas.pxToUpm(style.size);

  canvas.ctx.save();
  canvas.ctx.lineWidth = canvas.pxToUpm(style.lineWidth);
  canvas.ctx.fillStyle = style.fill;
  canvas.ctx.strokeStyle = style.stroke;

  canvas.ctx.beginPath();
  canvas.ctx.arc(point.x, point.y, radiusUpm, 0, Math.PI * 2);
  canvas.ctx.stroke();
  canvas.ctx.fill();

  if (style.overlayColor) {
    canvas.ctx.fillStyle = style.overlayColor;
    canvas.ctx.strokeStyle = style.overlayColor;
    canvas.ctx.beginPath();
    canvas.ctx.arc(point.x, point.y, radiusUpm, 0, Math.PI * 2);
    canvas.ctx.stroke();
    canvas.ctx.fill();
  }

  canvas.ctx.restore();
}

function drawDiamond(canvas: Canvas, point: Point2D, style: HandleStyle): void {
  const sizeUpm = canvas.pxToUpm(style.size);
  const half = sizeUpm / 2;

  const points = [
    { x: point.x, y: point.y - half },
    { x: point.x + half, y: point.y },
    { x: point.x, y: point.y + half },
    { x: point.x - half, y: point.y },
  ];

  canvas.ctx.save();
  canvas.ctx.lineWidth = canvas.pxToUpm(style.lineWidth);
  canvas.ctx.fillStyle = style.fill;
  canvas.ctx.strokeStyle = style.stroke;

  canvas.ctx.beginPath();
  canvas.ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    canvas.ctx.lineTo(points[i].x, points[i].y);
  }
  canvas.ctx.closePath();
  canvas.ctx.stroke();
  canvas.ctx.fill();

  if (style.overlayColor) {
    canvas.ctx.fillStyle = style.overlayColor;
    canvas.ctx.strokeStyle = style.overlayColor;
    canvas.ctx.beginPath();
    canvas.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      canvas.ctx.lineTo(points[i].x, points[i].y);
    }
    canvas.ctx.closePath();
    canvas.ctx.stroke();
    canvas.ctx.fill();
  }

  canvas.ctx.restore();
}

function drawHorizontalLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  angle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-width / 2, 0);
  ctx.lineTo(width / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size / 2, -size * 0.866);
  ctx.lineTo(-size / 2, size * 0.866);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
