import type { Editor } from "@shift/editor";
import type { Glyph } from "@shift/editor/model";
import { computed, track, type Signal } from "@shift/editor/signals";
import { axisValue, drawingName } from "@shift/editor/variation";
import type { AxisId, LayerId } from "@shift/types";
import type { GlyphAxesSection, GlyphAxisDraft, GlyphSourceRow } from "@/types/glyphAxes";

/** The glyph the editor edits alone, subscribed to; null without exactly one glyph node. */
function editedGlyph(editor: Editor): Glyph | null {
  const nodeCell = editor.scene.onlyCell("glyph");
  track(nodeCell);
  const node = nodeCell.peek();
  return node ? editor.glyphForId(node.glyphId) : null;
}

/**
 * The Designspace tab's Glyph axes section: one row per axis of the glyph
 * being edited, at the value the canvas draws it at.
 *
 * @returns null while no single glyph is edited; empty rows for a glyph with
 * no axes of its own, which the section shows as "None".
 */
export function glyphAxesCell(editor: Editor): Signal<GlyphAxesSection | null> {
  return computed(() => {
    const glyph = editedGlyph(editor);
    if (!glyph) return null;

    track(glyph.entryCell);
    const location = editor.glyphLocationCell.value;
    const rows = glyph.axesCell.value.map((axis) => ({ axis, value: axisValue(location, axis) }));
    return { glyphName: glyph.name, rows };
  });
}

/**
 * Moves where the canvas draws the edited glyph along one of its own axes.
 *
 * @returns false when the axis is not one of the edited glyph's.
 */
export function setGlyphAxis(editor: Editor, axisId: AxisId, value: number): boolean {
  const glyph = editedGlyph(editor);
  const axis = glyph?.axes.find((candidate) => candidate.id === axisId);
  if (!axis) return false;

  editor.setGlyphAxisValue(axis, Math.min(axis.maximum, Math.max(axis.minimum, value)));
  return true;
}

/**
 * The edited glyph's own sources, as the Designspace tab's Glyph sources
 * section lists them: its drawings off the font's sources (brace drawings
 * included), each named by where it sits.
 *
 * @returns null while no single glyph is edited; an empty list for a glyph
 * with none, which the section shows as "None".
 */
export function glyphSourcesCell(editor: Editor): Signal<readonly GlyphSourceRow[] | null> {
  return computed(() => {
    const glyph = editedGlyph(editor);
    if (!glyph) return null;

    const designspace = editor.font.designspace;
    const active = editor.activeDrawingCell.value;
    return glyph.locatedLayers.flatMap((layer) => {
      const location = glyph.drawingLocation(layer);
      if (!location) return [];

      return [
        {
          layerId: layer.id,
          name: drawingName(designspace, glyph, location),
          active: layer === active,
        },
      ];
    });
  });
}

/**
 * Whether a glyph source can be added where the sliders sit: the edited glyph
 * has no source or glyph source there.
 *
 * @remarks
 * A boolean, so a slider scrub that keeps it re-renders nothing.
 */
export function canAddGlyphSourceCell(editor: Editor): Signal<boolean> {
  return computed(() => {
    const glyph = editedGlyph(editor);
    if (!glyph || editor.activeSourceIdCell.value !== null) return false;

    const location = editor.editLocationCell.value;
    return !glyph.layerAt(location) && !glyph.sourceAt(location);
  });
}

/** Edits the glyph source `layerId`, moving the sliders to where it sits, as selecting a source does. */
export function selectGlyphSource(editor: Editor, layerId: LayerId): void {
  editor.selectDrawing(layerId);
}

/**
 * Adds a glyph source to the edited glyph where the sliders sit, starting
 * from the outline shown there.
 *
 * @returns The new glyph source's layer id, or null when there is a source or glyph source there.
 */
export async function addGlyphSourceHere(editor: Editor): Promise<LayerId | null> {
  const layerId = editor.addDrawingHere();
  if (layerId) await editor.font.editCoordinator.settled();
  return layerId;
}

/** Deletes one of the edited glyph's own sources. */
export async function deleteGlyphSource(editor: Editor, layerId: LayerId): Promise<void> {
  editor.deleteDrawing(layerId);
  await editor.font.editCoordinator.settled();
}

/**
 * Adds an axis to the glyph being edited, its tag made from the name.
 *
 * @returns The new axis's id, or null with no single glyph edited.
 * @throws {Error} when the engine refuses the axis.
 */
export async function addGlyphAxis(editor: Editor, draft: GlyphAxisDraft): Promise<AxisId | null> {
  const node = editor.scene.only("glyph");
  if (!node) return null;

  return editor.font.createGlyphAxis(node.glyphId, {
    name: draft.name.trim(),
    tag: null,
    range: { minimum: draft.minimum, default: draft.default, maximum: draft.maximum },
  });
}

/**
 * Renames one of the edited glyph's axes and gives it a new range, each as
 * its own undo step, only where they changed. A range never moves a stored
 * value; one that would leave a value outside it is refused.
 *
 * @throws {Error} with the engine's reason when an edit is refused.
 */
export async function editGlyphAxis(
  editor: Editor,
  axisId: AxisId,
  draft: GlyphAxisDraft,
): Promise<void> {
  const glyph = editedGlyph(editor);
  const axis = glyph?.axes.find((candidate) => candidate.id === axisId);
  if (!axis) return;

  const name = draft.name.trim();
  if (name !== axis.name) await editor.font.editGlyphAxis(axisId, { kind: "name", name });

  const range = { minimum: draft.minimum, default: draft.default, maximum: draft.maximum };
  const unchanged =
    range.minimum === axis.minimum &&
    range.default === axis.kind.default &&
    range.maximum === axis.maximum;
  if (!unchanged) await editor.font.editGlyphAxis(axisId, { kind: "range", range });
}

/**
 * Removes one of the edited glyph's axes.
 *
 * @throws {Error} naming each drawing and component that still sets it.
 */
export async function removeGlyphAxis(editor: Editor, axisId: AxisId): Promise<void> {
  const axis = editedGlyph(editor)?.axes.find((candidate) => candidate.id === axisId);
  await editor.font.editGlyphAxis(axisId, { kind: "remove" });
  // The glyph is no longer drawn along it.
  if (axis) editor.setGlyphAxisValue(axis, axis.kind.default);
}
