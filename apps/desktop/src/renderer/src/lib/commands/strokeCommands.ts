import type { Editor, GlyphLayer } from "@shift/editor";
import type { ContourId, OutlineStrokeStyle } from "@shift/types";
import type {
  StrokeAvailability,
  StrokeCommandId,
  StrokeCommandResult,
  StrokeExpandRequest,
  StrokeOffsetRequest,
  StrokeSelectedContour,
  StrokeSelection,
  StrokeStylePatch,
} from "@/types/stroke";
import { isDynamicStroke, strokeAvailability } from "./strokeAvailability";

/** Flattening tolerance for baked outlines and offsets: shift-font's `DEFAULT_TOLERANCE`. */
const STROKE_TOLERANCE = 0.25;

const OK: StrokeCommandResult = { ok: true };

/** The style a new stroke gets: the one last set in `editor`, or the default. */
export function strokeStyleToApply(editor: Editor): OutlineStrokeStyle {
  return editor.newStrokeStyleCell.peek();
}

/** The selection a stroke command would act on, and the layer it would edit. */
export interface ResolvedStrokeSelection {
  readonly selection: StrokeSelection;
  /** The editable layer, set exactly when `selection.layer.kind` is `editable`. */
  readonly layer: GlyphLayer | null;
}

/**
 * Reads what the stroke commands depend on from the editor's selection.
 *
 * A contour counts as selected when any of its points or segments, or the
 * contour itself, is selected. Which contours carry a dynamic stroke is the
 * engine's answer, read per layer.
 */
export function resolveStrokeSelection(editor: Editor): ResolvedStrokeSelection {
  const readOnly = editor.sessionMode === "preview" || editor.font.refusesEdits;
  const closedByContour = selectedContourClosedness(editor);
  const ids = [...closedByContour.keys()];

  const withoutLayer = (layer: StrokeSelection["layer"]): ResolvedStrokeSelection => ({
    selection: {
      readOnly,
      layer,
      contours: ids.map((id) => ({
        id,
        closed: closedByContour.get(id) === true,
        style: null,
      })),
    },
    layer: null,
  });

  if (ids.length === 0) return withoutLayer({ kind: "none" });

  const layer = editor.layerForGeometry({ contours: ids });
  if (!layer) return withoutLayer({ kind: "none" });
  if (layer.sourceId !== editor.activeSourceId) return withoutLayer({ kind: "inactiveSource" });

  const styles = readStrokeStyles(editor, layer);
  if (typeof styles === "string") return withoutLayer({ kind: "unreadable", message: styles });

  return {
    selection: {
      readOnly,
      layer: { kind: "editable" },
      contours: ids.map((id) => ({
        id,
        closed: closedByContour.get(id) === true,
        style: styles.get(id) ?? null,
      })),
    },
    layer,
  };
}

/** Whether `id` can run on the editor's current selection, and why not when it cannot. */
export function strokeAvailabilityFor(editor: Editor, id: StrokeCommandId): StrokeAvailability {
  return strokeAvailability(id, resolveStrokeSelection(editor).selection);
}

/** The commands among `ids` that would run on the editor's current selection, in the order given. */
export function availableStrokeCommands<Id extends StrokeCommandId>(
  editor: Editor,
  ids: readonly Id[],
): Id[] {
  const { selection } = resolveStrokeSelection(editor);

  return ids.filter((id) => strokeAvailability(id, selection).enabled);
}

/**
 * Gives the selected contours a dynamic stroke, replacing any they already have.
 *
 * The stroke takes `style`, or the style last set in this editor when none is given.
 */
export function applyDynamicStroke(
  editor: Editor,
  style: OutlineStrokeStyle = strokeStyleToApply(editor),
): StrokeCommandResult {
  const result = runStrokeCommand(
    editor,
    "glyph.stroke.applyDynamic",
    "Apply dynamic stroke",
    (target) => {
      target.layer.setLiveStroke(contourIds(target.contours), style);
    },
  );
  if (result.ok) editor.newStrokeStyleCell.set(style);

  return result;
}

/**
 * Changes the fields in `patch` on every selected dynamic stroke, as one undo step.
 *
 * Each contour keeps the fields the patch leaves out, so two strokes with different joins keep
 * them when only the width changes. The patch also becomes part of the style new strokes start
 * with. Selected contours without a dynamic stroke are left alone.
 */
export function updateStrokeStyle(editor: Editor, patch: StrokeStylePatch): StrokeCommandResult {
  const result = runStrokeCommand(editor, "glyph.stroke.updateStyle", "Change stroke", (target) => {
    for (const contour of target.contours) {
      if (!contour.style) continue;

      target.layer.setLiveStroke([contour.id], { ...contour.style, ...patch });
    }
  });
  if (result.ok) editor.newStrokeStyleCell.set({ ...strokeStyleToApply(editor), ...patch });

  return result;
}

/**
 * Turns the selected dynamic strokes into plain outline fills, using the style each stores.
 * Selected contours without a dynamic stroke are left as they are.
 */
export function expandStroke(editor: Editor): StrokeCommandResult {
  return runStrokeCommand(editor, "glyph.stroke.expand", "Expand stroke", (target) => {
    target.layer.bakeStrokeOutlines(dynamicContourIds(target.contours), STROKE_TOLERANCE);
  });
}

/**
 * Expands the selection with `request.style`.
 *
 * Keeping the contour editable makes every selected contour a dynamic stroke.
 * Otherwise a dynamic contour takes the style and is baked to fills, and a plain
 * contour is outlined in place, all as one undo step.
 */
export function expandStrokeWithStyle(
  editor: Editor,
  request: StrokeExpandRequest,
): StrokeCommandResult {
  const { selection } = resolveStrokeSelection(editor);
  const label = expandLabel(selection.contours, request);

  return runStrokeCommand(editor, "glyph.stroke.expandWithStyle", label, (target) => {
    if (request.keepEditable) {
      target.layer.setLiveStroke(contourIds(target.contours), request.style);
      return;
    }

    const dynamic = dynamicContourIds(target.contours);
    const plain = plainContourIds(target.contours);

    if (dynamic.length > 0) {
      target.layer.setLiveStroke(dynamic, request.style);
      target.layer.bakeStrokeOutlines(dynamic, STROKE_TOLERANCE);
    }

    if (plain.length > 0) target.layer.outlineStroke(plain, request.style, STROKE_TOLERANCE);
  });
}

/**
 * Offsets the one selected contour, open or closed, to the left of its direction for a negative
 * distance and to the right for a positive one: a counter-clockwise outline grows when positive.
 */
export function offsetSelectedContour(
  editor: Editor,
  request: StrokeOffsetRequest,
): StrokeCommandResult {
  return runStrokeCommand(editor, "glyph.stroke.offsetContour", "Offset contour", (target) => {
    const [contour] = target.contours;
    if (!contour) return;

    target.layer.offsetContour(
      contour.id,
      request.distance,
      request.join,
      request.miterLimit,
      STROKE_TOLERANCE,
    );
  });
}

/** Drops the dynamic stroke from the selected contours and keeps them as plain contours. */
export function removeDynamicStroke(editor: Editor): StrokeCommandResult {
  return runStrokeCommand(
    editor,
    "glyph.stroke.removeDynamic",
    "Remove dynamic stroke",
    (target) => {
      target.layer.removeLiveStroke(dynamicContourIds(target.contours));
    },
  );
}

interface StrokeTarget {
  readonly layer: GlyphLayer;
  readonly contours: readonly StrokeSelectedContour[];
}

/**
 * Checks availability, then runs `edit` as one undo step.
 *
 * A refusal, from availability or from the engine rejecting the edit, carries
 * a reason and leaves the document as it was.
 */
function runStrokeCommand(
  editor: Editor,
  id: StrokeCommandId,
  label: string,
  edit: (target: StrokeTarget) => void,
): StrokeCommandResult {
  const { selection, layer } = resolveStrokeSelection(editor);

  const availability = strokeAvailability(id, selection);
  if (!availability.enabled) return refused(availability.reason);
  if (!layer) return refused("Select contours that belong to one editable layer.");

  try {
    editor.transaction(label, () => edit({ layer, contours: selection.contours }));
  } catch (error) {
    return refused(`${label} failed: ${errorMessage(error)}`);
  }

  return OK;
}

function refused(reason: string): StrokeCommandResult {
  return { ok: false, reason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expandLabel(
  contours: readonly StrokeSelectedContour[],
  request: StrokeExpandRequest,
): string {
  if (request.keepEditable) return "Apply dynamic stroke";
  if (contours.some(isDynamicStroke)) return "Expand stroke";

  return "Outline stroke";
}

function contourIds(contours: readonly StrokeSelectedContour[]): ContourId[] {
  return contours.map((contour) => contour.id);
}

function dynamicContourIds(contours: readonly StrokeSelectedContour[]): ContourId[] {
  return contours.filter(isDynamicStroke).map((contour) => contour.id);
}

function plainContourIds(contours: readonly StrokeSelectedContour[]): ContourId[] {
  return contours.filter((contour) => !isDynamicStroke(contour)).map((contour) => contour.id);
}

/** The contours the selection reaches through points, segments and contours, with whether each is closed. */
function selectedContourClosedness(editor: Editor): Map<ContourId, boolean> {
  const closedByContour = new Map<ContourId, boolean>();

  for (const object of editor.objects(editor.selection.ids)) {
    switch (object.kind) {
      case "point":
      case "segment":
      case "contour": {
        const closed = object.geometry.contour(object.contourId)?.closed === true;
        closedByContour.set(object.contourId, closed);
        break;
      }

      case "anchor":
      case "component":
      case "node":
        break;
    }
  }

  return closedByContour;
}

/** The style of each dynamic stroke on `layer`, or the reason the engine could not say. */
function readStrokeStyles(
  editor: Editor,
  layer: GlyphLayer,
): ReadonlyMap<ContourId, OutlineStrokeStyle> | string {
  try {
    const strokes = editor.font.liveStrokes(layer.id);
    return new Map(strokes.map((stroke) => [stroke.contourId, stroke.style]));
  } catch (error) {
    return errorMessage(error);
  }
}
