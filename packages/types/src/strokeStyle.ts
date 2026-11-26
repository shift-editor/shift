import type { OutlineStrokeStyle } from "./bridge";

/**
 * The nib (calligraphic pen nib) shape for a dynamic stroke.
 *
 * @remarks
 * This is a forward-looking placeholder for the nib phase (stream B).  When
 * nib intents land in `shift-bridge`, **replace this interface** with a
 * `Pick` or re-export of the generated bridge type rather than keeping a
 * hand-rolled copy.
 */
export interface NibShape {
  readonly width: number;
  readonly height: number;
  /** Rotation of the nib ellipse, in radians. */
  readonly angle: number;
}

/** Circular nib matching a monoline stroke at `width`. */
export function circularNib(width: number): NibShape {
  return { width, height: width, angle: 0 };
}

/**
 * Fills in a default circular nib when no explicit `nib` is provided.
 * Convenience for constructing {@link OutlineStrokeStyle} values in tests and
 * application code without repeating the nib field for round strokes.
 */
export function outlineStrokeStyle(
  style: Omit<OutlineStrokeStyle, "nib"> & { nib?: NibShape },
): OutlineStrokeStyle {
  return { ...style, nib: style.nib ?? circularNib(style.width) };
}
