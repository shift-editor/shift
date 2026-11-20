import type { ContourId, OutlineStrokeStyle, StrokeJoin } from "@shift/types";

/** Commands that act on the selection's dynamic strokes and contours. */
export type StrokeCommandId =
  | "glyph.stroke.applyDynamic"
  | "glyph.stroke.expand"
  | "glyph.stroke.expandWithStyle"
  | "glyph.stroke.offsetContour"
  | "glyph.stroke.removeDynamic";

/** Whether a stroke command can run now, and why not when it cannot. */
export type StrokeAvailability =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: string };

/** How a stroke command ended: ran, or refused with a reason the user can read. */
export type StrokeCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether the layer the selected contours live on can take stroke edits.
 *
 * `none` covers contours that do not share one authored layer; `unreadable`
 * means the engine could not say which contours carry a dynamic stroke.
 */
export type StrokeLayerState =
  | { readonly kind: "editable" }
  | { readonly kind: "none" }
  | { readonly kind: "inactiveSource" }
  | { readonly kind: "unreadable"; readonly message: string };

/** One selected contour, with the facts the stroke commands depend on. */
export interface StrokeSelectedContour {
  readonly id: ContourId;
  readonly closed: boolean;
  /** Whether the contour carries a dynamic stroke, as the engine reports it. */
  readonly dynamic: boolean;
}

/** Everything {@link StrokeAvailability} is decided from. */
export interface StrokeSelection {
  /** The font refuses edits: a preview font, or an edit gate that is closed. */
  readonly readOnly: boolean;
  readonly layer: StrokeLayerState;
  readonly contours: readonly StrokeSelectedContour[];
}

/** The style an expand applies, and whether the contour stays editable afterwards. */
export interface StrokeExpandRequest {
  readonly style: OutlineStrokeStyle;
  /** On: the contours become dynamic strokes. Off: they become plain outline fills. */
  readonly keepEditable: boolean;
}

/** How far and how corners meet when one closed contour grows or shrinks. */
export interface StrokeOffsetRequest {
  readonly distance: number;
  readonly join: StrokeJoin;
  readonly miterLimit: number;
}
