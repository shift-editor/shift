import type { Editor } from "@shift/editor";
import { computed, track, type Signal } from "@shift/editor/signals";
import type { OutlineStrokeStyle } from "@shift/types";
import type { StrokePreset } from "@shift/wasm/protocol";
import type {
  StrokeSectionView,
  StrokeSelectedContour,
  StrokeSelection,
  StrokeStylePatch,
} from "@/types/stroke";
import { isDynamicStroke, strokeAvailability } from "@/lib/commands/strokeAvailability";
import { resolveStrokeSelection } from "@/lib/commands/strokeCommands";

/** The most a stroke can lie to either side of its path, as a percentage. */
const MAX_POSITION_PERCENT = 100;

/**
 * What the Stroke section shows for the editor's selection, re-derived when the selection, a
 * contour or a stored stroke changes.
 */
export function strokeSectionViewCell(editor: Editor): Signal<StrokeSectionView | null> {
  return computed(
    () => {
      // The selection and the edited source are read without subscribing, so subscribe here.
      track(editor.selection.stateCell);
      track(editor.activeSourceIdCell);

      const presets = editor.font.strokePresetsCell.value;

      return strokeSectionView(resolveStrokeSelection(editor).selection, presets);
    },
    { name: "strokeSectionView" },
  );
}

/**
 * What the Stroke section shows for `selection`, or null when it has no place there.
 *
 * @remarks
 * The section waits for a selected contour on one layer. A read-only font, a source that is not
 * the one being edited, or an unreadable layer keeps the section but disables its controls.
 */
export function strokeSectionView(
  selection: StrokeSelection,
  presets: readonly StrokePreset[] = [],
): StrokeSectionView | null {
  if (selection.contours.length === 0) return null;
  if (selection.layer.kind === "none") return null;

  const strokes = selection.contours.filter(isDynamicStroke);
  const availability = strokeAvailability(
    strokes.length > 0 ? "glyph.stroke.updateStyle" : "glyph.stroke.applyDynamic",
    selection,
  );
  const styles = strokes.flatMap(({ style }) => (style ? [style] : []));
  const join = shared(styles, (style) => style.join);
  const openStyles = openStrokeStyles(strokes);

  return {
    canAdd: strokes.length < selection.contours.length,
    hasStroke: strokes.length > 0,
    disabledReason: availability.enabled ? null : availability.reason,
    width: shared(styles, (style) => style.width),
    positionPercent: percentOf(shared(styles, (style) => style.position)),
    join,
    showsMiterLimit: join === "miter",
    miterLimit: shared(styles, (style) => style.miterLimit),
    showsCap: openStyles.length > 0,
    cap: shared(openStyles, (style) => style.cap),
    presets,
  };
}

/** The thinnest stroke the section sets: below this the engine refuses, so the field stops here. */
const MIN_WIDTH = 1;

/** The smallest miter limit that still means something: a limit under 1 would bevel every corner. */
const MIN_MITER_LIMIT = 1;

/** The patch a typed width makes, held to the thinnest stroke the section sets. */
export function widthPatch(width: number): StrokeStylePatch {
  return { width: Math.max(MIN_WIDTH, width) };
}

/** The patch a typed miter limit makes, held to the smallest limit that means something. */
export function miterLimitPatch(miterLimit: number): StrokeStylePatch {
  return { miterLimit: Math.max(MIN_MITER_LIMIT, miterLimit) };
}

/** The patch a typed position percentage makes, held to the range a stroke can have. */
export function positionPatch(percent: number): StrokeStylePatch {
  const held = Math.min(MAX_POSITION_PERCENT, Math.max(-MAX_POSITION_PERCENT, percent));

  return { position: held / MAX_POSITION_PERCENT };
}

function openStrokeStyles(
  strokes: readonly StrokeSelectedContour[],
): readonly OutlineStrokeStyle[] {
  return strokes.flatMap(({ closed, style }) => (!closed && style ? [style] : []));
}

/** The value `read` gives every style, or null when there is none or they differ. */
function shared<Value>(
  styles: readonly OutlineStrokeStyle[],
  read: (style: OutlineStrokeStyle) => Value,
): Value | null {
  const [first] = styles;
  if (!first) return null;

  const value = read(first);
  return styles.every((style) => read(style) === value) ? value : null;
}

/** A stored position as the percentage shown, free of floating point noise. */
function percentOf(position: number | null): number | null {
  if (position === null) return null;

  return Math.round(position * MAX_POSITION_PERCENT * 100) / 100;
}
