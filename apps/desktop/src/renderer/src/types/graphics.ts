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

export type CanvasRef = React.RefObject<HTMLCanvasElement | null>;

/** Converts screen-pixel measurements into UPM-space distances. */
export interface ScreenConverter {
  toUpmDistance(pixels: number): number;
}

/**
 * Visual category of a point handle drawn on the glyph outline.
 * - `corner` -- on-curve point with an angle discontinuity (square handle).
 * - `smooth` -- on-curve point with continuous tangent (circle handle).
 * - `control` -- off-curve Bezier control point (small diamond).
 * - `anchor` -- glyph attachment anchor (diamond handle).
 * - `direction` -- first point of a closed contour, indicates path direction (triangle).
 * - `first` / `last` -- endpoints of an open contour (directional arrows).
 */
export type HandleType =
  | "corner"
  | "smooth"
  | "control"
  | "anchor"
  | "direction"
  | "first"
  | "last";
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
