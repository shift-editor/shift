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
} from "@/types/stroke";
import { strokeAvailability } from "./strokeAvailability";

/** Flattening tolerance for baked outlines and offsets: shift-font's `DEFAULT_TOLERANCE`. */
const STROKE_TOLERANCE = 0.25;

const OK: StrokeCommandResult = { ok: true };

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
      contours: ids.map((id) => ({ id, closed: closedByContour.get(id) === true, dynamic: false })),
    },
    layer: null,
  });

  if (ids.length === 0) return withoutLayer({ kind: "none" });

  const layer = editor.layerForGeometry({ contours: ids });
  if (!layer) return withoutLayer({ kind: "none" });
  if (layer.sourceId !== editor.activeSourceId) return withoutLayer({ kind: "inactiveSource" });

  const dynamicIds = readDynamicContours(editor, layer);
  if (typeof dynamicIds === "string")
    return withoutLayer({ kind: "unreadable", message: dynamicIds });

  return {
    selection: {
      readOnly,
      layer: { kind: "editable" },
      contours: ids.map((id) => ({
        id,
        closed: closedByContour.get(id) === true,
        dynamic: dynamicIds.has(id),
      })),
    },
    layer,
  };
}

/** Whether `id` can run on the editor's current selection, and why not when it cannot. */
export function strokeAvailabilityFor(editor: Editor, id: StrokeCommandId): StrokeAvailability {
  return strokeAvailability(id, resolveStrokeSelection(editor).selection);
}

/** Gives the selected contours a dynamic stroke of `style`, replacing any they already have. */
export function applyDynamicStroke(editor: Editor, style: OutlineStrokeStyle): StrokeCommandResult {
  return runStrokeCommand(editor, "glyph.stroke.applyDynamic", "Apply dynamic stroke", (target) => {
    target.layer.setLiveStroke(contourIds(target.contours), style);
  });
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

/** Grows (positive distance) or shrinks (negative) the one selected closed contour. */
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
  if (contours.some((contour) => contour.dynamic)) return "Expand stroke";

  return "Outline stroke";
}

function contourIds(contours: readonly StrokeSelectedContour[]): ContourId[] {
  return contours.map((contour) => contour.id);
}

function dynamicContourIds(contours: readonly StrokeSelectedContour[]): ContourId[] {
  return contours.filter((contour) => contour.dynamic).map((contour) => contour.id);
}

function plainContourIds(contours: readonly StrokeSelectedContour[]): ContourId[] {
  return contours.filter((contour) => !contour.dynamic).map((contour) => contour.id);
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

/** The contours on `layer` that carry a dynamic stroke, or the reason the engine could not say. */
function readDynamicContours(editor: Editor, layer: GlyphLayer): ReadonlySet<ContourId> | string {
  try {
    return new Set(editor.font.liveStrokeContours(layer.id));
  } catch (error) {
    return errorMessage(error);
  }
}
