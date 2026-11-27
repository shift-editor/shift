import type { ContourId, OutlineStrokeStyle, StrokeCap, StrokeJoin } from "@shift/types";
import type { StrokePreset } from "@shift/wasm/protocol";

/** Commands that act on the selection's dynamic strokes and contours. */
export type StrokeCommandId =
  | "glyph.stroke.applyDynamic"
  | "glyph.stroke.expand"
  | "glyph.stroke.expandWithStyle"
  | "glyph.stroke.offsetContour"
  | "glyph.stroke.removeDynamic"
  | "glyph.stroke.updateStyle";

/**
 * The stroke commands the native menu runs on the selection. Left out: the sidebar's style edit,
 * Offset Contour… (opens a dialog for its distance), and expand-with-a-style, which only agents
 * and tests run.
 */
export type StrokeMenuCommandId = Exclude<
  StrokeCommandId,
  "glyph.stroke.updateStyle" | "glyph.stroke.offsetContour" | "glyph.stroke.expandWithStyle"
>;

/** The stroke commands the canvas context menu lists, each only while it would run. */
export type StrokeContextCommandId = Extract<
  StrokeCommandId,
  | "glyph.stroke.applyDynamic"
  | "glyph.stroke.expand"
  | "glyph.stroke.removeDynamic"
  | "glyph.stroke.offsetContour"
>;

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
  /** The style of the contour's dynamic stroke, as the engine reports it; null for a plain contour. */
  readonly style: OutlineStrokeStyle | null;
}

/** The fields of a stroke style a change sets; the rest keep the value each contour has. */
export type StrokeStylePatch = Partial<OutlineStrokeStyle>;

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

/**
 * How far and how corners meet when one contour is offset. The side follows the path direction:
 * a negative distance is left of the direction of travel, a positive one right.
 */
export interface StrokeOffsetRequest {
  readonly distance: number;
  readonly join: StrokeJoin;
  readonly miterLimit: number;
}

/** What the Offset Contour dialog's fields hold: the text typed, and the join chosen. */
export interface StrokeOffsetFields {
  readonly distance: string;
  readonly join: StrokeJoin;
  readonly miterLimit: string;
}

/** The dialog's fields read as an offset: ready to run, or the problem to show under them. */
export type StrokeOffsetInput =
  | { readonly kind: "ready"; readonly request: StrokeOffsetRequest }
  | { readonly kind: "invalid"; readonly problem: string };

/**
 * What the Stroke section of the sidebar shows for a selection.
 *
 * A field is `null` when the selected strokes disagree on it: the section shows it as Mixed.
 */
export interface StrokeSectionView {
  /** Some selected contour has no dynamic stroke yet, so the section offers to add one. */
  readonly canAdd: boolean;
  /** Some selected contour carries a dynamic stroke, so its fields and menu show. */
  readonly hasStroke: boolean;
  /** Why the section's controls cannot change anything, or null when they can. */
  readonly disabledReason: string | null;
  readonly width: number | null;
  /** Where the stroke lies, as a percentage: −100 left of the path, 0 centred, 100 right. */
  readonly positionPercent: number | null;
  readonly join: StrokeJoin | null;
  /** Shown only while every selected stroke shares the miter join. */
  readonly showsMiterLimit: boolean;
  readonly miterLimit: number | null;
  /** Caps only matter on an open contour, so the row shows only when one is selected. */
  readonly showsCap: boolean;
  readonly cap: StrokeCap | null;
  /** Named stroke presets stored at the font level, in creation order. */
  readonly presets: readonly StrokePreset[];
}
