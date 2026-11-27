import type { StrokeOutlinePreviewItem } from "@shift/wasm/protocol";

/**
 * Discriminated union of drawing instructions that describe a path.
 * Used for serializing and replaying vector outlines independently of the canvas API.
 */
export type PathCommand =
  | { readonly type: "moveTo"; readonly x: number; readonly y: number }
  | { readonly type: "lineTo"; readonly x: number; readonly y: number }
  | {
      readonly type: "cubicTo";
      readonly cp1x: number;
      readonly cp1y: number;
      readonly cp2x: number;
      readonly cp2y: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "quadTo";
      readonly cp1x: number;
      readonly cp1y: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "close" };

/**
 * The solved fill outlines of the dynamic strokes on one glyph layer, with the
 * one canvas path they draw as.
 *
 * `failure` is why some stroke could not be drawn. When one contour failed,
 * `items` and `path` still hold the others. When the whole read failed,
 * `items` is empty and `path` is null: the layer has no solved fill, which is
 * not the same as having no dynamic stroke.
 */
export interface StrokeFills {
  readonly items: readonly StrokeOutlinePreviewItem[];
  readonly path: Path2D | null;
  readonly failure: string | null;
}

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
 * - `interpolated` -- the location is between sources; overrides interaction styling independently of session editability.
 */
export type HandleState = "idle" | "hovered" | "selected" | "interpolated";
