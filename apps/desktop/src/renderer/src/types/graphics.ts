import type { DrawStyle } from "@/lib/styles/style";

/**
 * Discriminated union of drawing instructions that describe a path.
 * Used for serializing and replaying vector outlines independently of the canvas API.
 */
export type PathCommand =
  | { type: "moveTo"; x: number; y: number }
  | { type: "lineTo"; x: number; y: number }
  | {
      type: "cubicTo";
      cp1x: number;
      cp1y: number;
      cp2x: number;
      cp2y: number;
      x: number;
      y: number;
    }
  | { type: "quadTo"; cp1x: number; cp1y: number; x: number; y: number }
  | { type: "close" };

/** RGBA colour as a four-element tuple (0-255 per channel). */
export type Colour = [number, number, number, number];

/** Minimal path-building interface for constructing line/move segments. */
export interface IPath {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/**
 * Low-level rendering abstraction over an HTML canvas context.
 *
 * All coordinates are in whichever space the caller has established via
 * `save()`/`transform()`. Render passes typically operate in UPM space;
 * bounding-box handles render in screen space.
 *
 * Path-building sequence: `beginPath()` -> `moveTo()` -> curve commands
 * (`lineTo`, `quadTo`, `cubicTo`) -> optionally `closePath()` -> `stroke()` or `fill()`.
 */
export interface IRenderer {
  save(): void;
  restore(): void;
  clear(): void;

  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias: boolean;
  dashPattern: number[];

  setStyle(style: DrawStyle): void;

  drawLine(x0: number, y0: number, x1: number, y1: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillCircle(x: number, y: number, radius: number): void;
  strokeCircle(x: number, y: number, radius: number): void;
  createPath(): IPath;
  beginPath(): void;
  moveTo(x: number, y: number): void;

  lineTo(x: number, y: number): void;
  quadTo(cpx: number, cpy: number, x: number, y: number): void;
  drawLine(x0: number, y0: number, x1: number, y1: number): void;
  cubicTo(cpx1: number, cpy1: number, cpx2: number, cpy2: number, x: number, y: number): void;
  arcTo(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    isCounterClockwise?: boolean,
  ): void;

  closePath(): void;

  stroke(): void;
  fill(): void;
  fillPath(path: Path2D): void;
  strokePath(path: Path2D): void;

  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;

  /** Applies a 2D affine transform matrix `[a b c d e f]` to the current state. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
}

/**
 * Owns a canvas element and its associated {@link IRenderer}.
 * Handles resizing and teardown for a single canvas layer.
 */
export interface IGraphicContext {
  resizeCanvas(canvas: HTMLCanvasElement, rect: DOMRectReadOnly): void;

  getContext(): IRenderer;

  destroy(): void;
}

export type CanvasRef = React.RefObject<HTMLCanvasElement | null>;
export type GraphicsContextRef = React.RefObject<IGraphicContext | null>;

/** Converts screen-pixel measurements into UPM-space distances. */
export interface ScreenConverter {
  toUpmDistance(pixels: number): number;
}

/**
 * Visual category of a point handle drawn on the glyph outline.
 * - `corner` -- on-curve point with an angle discontinuity (square handle).
 * - `smooth` -- on-curve point with continuous tangent (circle handle).
 * - `control` -- off-curve Bezier control point (small diamond).
 * - `direction` -- first point of a closed contour, indicates path direction (triangle).
 * - `first` / `last` -- endpoints of an open contour (directional arrows).
 */
export type HandleType = "corner" | "smooth" | "control" | "direction" | "first" | "last";
/**
 * Interaction state that determines handle styling (colour, size).
 * - `idle` -- default appearance.
 * - `hovered` -- mouse is over the handle; slightly enlarged or recoloured.
 * - `selected` -- handle is part of the active selection; filled with accent colour.
 */
export type HandleState = "idle" | "hovered" | "selected";

/** Stroke properties for shape rendering. */
export interface StrokeStyle {
  strokeStyle?: string;
  strokeWidth?: number;
  dashPattern?: number[];
}

/** Fill properties for shape rendering. */
export interface FillStyle {
  fillStyle?: string;
}

/** Combined stroke and fill properties for shape rendering. */
export interface ShapeStyle extends StrokeStyle, FillStyle {}
