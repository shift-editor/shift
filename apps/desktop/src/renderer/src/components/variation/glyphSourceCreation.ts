import type { Editor } from "@shift/editor";
import type { Axis, Glyph } from "@shift/editor/model";
import { asExternalAxisLocation, axisValue, drawingName } from "@shift/editor/variation";
import type { AxisId, LayerId } from "@shift/types";
import type { ExternalAxisLocation } from "@shift/editor/types";
import { addGlyphSourceHere } from "@/lib/variation/glyphAxes";
import { LocationDraft, type DraftIssue, type LocationDraftValues } from "./locationDraft";

/** The glyph the editor edits alone; null without exactly one glyph node. */
function editedGlyph(editor: Editor): Glyph | null {
  const node = editor.scene.only("glyph");
  return node ? editor.glyphForId(node.glyphId) : null;
}

/**
 * The axes a new glyph source's panel has a field for, in field order: the
 * font's axes, then the edited glyph's own.
 */
export function glyphSourceAxes(editor: Editor): readonly Axis[] {
  const own = editedGlyph(editor)?.axes ?? [];
  return [...editor.font.axesCell.peek(), ...own];
}

/**
 * The panel's starting values: where the sliders sit, the font's axes in
 * user units and the glyph's own in theirs.
 */
export function currentGlyphSourceValues(
  editor: Editor,
  axes: readonly Axis[],
): LocationDraftValues {
  const location = editor.editLocation;
  return {
    name: "",
    location: Object.fromEntries(axes.map((axis) => [axis.id, String(axisValue(location, axis))])),
  };
}

/**
 * Why a glyph source can't be created at the typed location: a field that
 * is not a number or is outside its axis's range, or a source or glyph source
 * already there ("Spread 100 is already here").
 *
 * @returns null when Create may go ahead.
 */
export function glyphSourceIssue(
  editor: Editor,
  axes: readonly Axis[],
  values: LocationDraftValues["location"],
): DraftIssue | null {
  const draft = new LocationDraft({ name: "", location: values });
  for (const axis of axes) {
    const value = draft.coordinate(axis);
    if (!Number.isFinite(value)) {
      return { kind: "axis", axisId: axis.id, message: `Enter a number for ${axis.name}` };
    }
    if (value < axis.minimum || value > axis.maximum) {
      return {
        kind: "axis",
        axisId: axis.id,
        message: `${axis.name} must be between ${axis.minimum} and ${axis.maximum}`,
      };
    }
  }

  const glyph = editedGlyph(editor);
  const location = typedLocation(axes, draft);
  if (!glyph) return null;

  const occupant = occupantName(editor, glyph, location);
  return occupant ? { kind: "location", message: `${occupant} is already here` } : null;
}

/**
 * Adds a glyph source at the typed location, starting from the outline the
 * glyph draws there, and edits it: the sliders move there and it is the
 * glyph source selected.
 *
 * @returns The new glyph source's layer id, or null when the location is taken
 * or a field is invalid.
 */
export async function createGlyphSource(
  editor: Editor,
  axes: readonly Axis[],
  values: LocationDraftValues["location"],
): Promise<LayerId | null> {
  if (glyphSourceIssue(editor, axes, values)) return null;

  const glyph = editedGlyph(editor);
  if (!glyph) return null;

  const location = typedLocation(axes, new LocationDraft({ name: "", location: values }));
  const own = new Set<AxisId>(glyph.axes.map((axis) => axis.id));
  const onFontAxes = asExternalAxisLocation(
    new Map(location.entries().filter(([axisId]) => !own.has(axisId))),
  );
  editor.setExternalLocation(onFontAxes);
  for (const axis of glyph.axes) editor.setGlyphAxisValue(axis, axisValue(location, axis));
  return addGlyphSourceHere(editor);
}

function typedLocation(axes: readonly Axis[], draft: LocationDraft): ExternalAxisLocation {
  return asExternalAxisLocation(new Map(axes.map((axis) => [axis.id, draft.coordinate(axis)])));
}

/** The name of the source or glyph source the glyph has at `location`, if any. */
function occupantName(editor: Editor, glyph: Glyph, location: ExternalAxisLocation): string | null {
  const layer = glyph.layerAt(location);
  if (layer?.isLocated) {
    const drawnAt = glyph.drawingLocation(layer);
    return drawnAt ? drawingName(editor.font.designspace, glyph, drawnAt) : null;
  }
  if (layer) return layer.source.name;

  return glyph.sourceAt(location)?.name ?? null;
}
