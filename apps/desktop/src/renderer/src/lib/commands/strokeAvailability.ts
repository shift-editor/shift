import type {
  StrokeAvailability,
  StrokeCommandId,
  StrokeSelectedContour,
  StrokeSelection,
} from "@/types/stroke";

const AVAILABLE: StrokeAvailability = { enabled: true };

function unavailable(reason: string): StrokeAvailability {
  return { enabled: false, reason };
}

/**
 * Whether a stroke command can run on `selection`, and the reason when it cannot.
 *
 * The one place that decides stroke availability: sidebar controls and menus
 * show the reason on a disabled control, and the command runner shows it when
 * something runs a command that is unavailable.
 */
export function strokeAvailability(
  id: StrokeCommandId,
  selection: StrokeSelection,
): StrokeAvailability {
  const shared = sharedAvailability(selection);
  if (!shared.enabled) return shared;

  switch (id) {
    case "glyph.stroke.applyDynamic":
    case "glyph.stroke.expandWithStyle":
      return AVAILABLE;

    case "glyph.stroke.expand":
    case "glyph.stroke.removeDynamic":
    case "glyph.stroke.updateStyle":
      return dynamicAvailability(selection);

    case "glyph.stroke.offsetContour":
      return offsetAvailability(selection);
  }
}

/** What every stroke command needs: an editable font, a selected contour, and a layer to edit. */
function sharedAvailability(selection: StrokeSelection): StrokeAvailability {
  if (selection.readOnly) {
    return unavailable("This font is open read-only, so strokes cannot be changed.");
  }

  if (selection.contours.length === 0) {
    return unavailable("Select a contour first.");
  }

  const { layer } = selection;
  switch (layer.kind) {
    case "editable":
      return AVAILABLE;

    case "none":
      return unavailable("Select contours that belong to one editable layer.");

    case "inactiveSource":
      return unavailable("Switch to the source these contours belong to before editing them.");

    case "unreadable":
      return unavailable(`Could not read the strokes on this layer: ${layer.message}`);
  }
}

/** Whether `contour` carries a dynamic stroke. */
export function isDynamicStroke(contour: StrokeSelectedContour): boolean {
  return contour.style !== null;
}

function dynamicAvailability(selection: StrokeSelection): StrokeAvailability {
  if (selection.contours.some(isDynamicStroke)) return AVAILABLE;

  return unavailable("None of the selected contours has a dynamic stroke.");
}

function offsetAvailability(selection: StrokeSelection): StrokeAvailability {
  const [contour] = selection.contours;
  if (selection.contours.length !== 1 || !contour) {
    return unavailable("Select exactly one contour to offset.");
  }

  return AVAILABLE;
}
