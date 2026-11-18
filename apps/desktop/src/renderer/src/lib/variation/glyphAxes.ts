import type { Editor } from "@shift/editor";
import type { Glyph } from "@shift/editor/model";
import { computed, track, type Signal } from "@shift/editor/signals";
import { axisValue, drawingName } from "@shift/editor/variation";
import type { AxisId, LayerId } from "@shift/types";
import type { GlyphAxesSection, GlyphAxisDraft, GlyphDrawingRow } from "@/types/glyphAxes";

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
 * no axes of its own, which the section offers to add.
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
 * The edited glyph's drawings located off the font's sources, as the Sources
 * list shows them after the font's sources, each named by where it sits.
 */
export function glyphDrawingsCell(editor: Editor): Signal<readonly GlyphDrawingRow[]> {
  return computed(() => {
    const glyph = editedGlyph(editor);
    if (!glyph) return [];

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
 * Whether "Add drawing here" applies: the sliders sit where the edited glyph
 * has no drawing and no font source.
 *
 * @remarks
 * A boolean, so a slider scrub that keeps it re-renders nothing; read the
 * place's name with {@link drawingHereName} when the menu opens.
 */
export function addDrawingHereCell(editor: Editor): Signal<boolean> {
  return computed(() => {
    const glyph = editedGlyph(editor);
    if (!glyph || editor.activeSourceIdCell.value !== null) return false;

    const location = editor.editLocationCell.value;
    return !glyph.layerAt(location) && !glyph.sourceAt(location);
  });
}

/**
 * The name of the place the sliders sit, as "Add drawing here" names it
 * ("Spread 60"), read once.
 *
 * @returns null with no single glyph edited.
 */
export function drawingHereName(editor: Editor): string | null {
  const node = editor.scene.only("glyph");
  const glyph = node ? editor.glyphForId(node.glyphId) : null;
  if (!glyph) return null;

  const location = glyph.space.toDesign(editor.editLocationCell.peek());
  return drawingName(editor.font.designspace, glyph, location);
}

/** Edits the drawing `layerId`, moving the sliders to where it sits, as selecting a source does. */
export function selectDrawing(editor: Editor, layerId: LayerId): void {
  editor.selectDrawing(layerId);
}

/**
 * Adds a drawing of the edited glyph where the sliders sit, starting from
 * the outline shown there.
 *
 * @returns The new drawing's layer id, or null when there is a drawing or source there.
 */
export async function addDrawingHere(editor: Editor): Promise<LayerId | null> {
  const layerId = editor.addDrawingHere();
  if (layerId) await editor.font.editCoordinator.settled();
  return layerId;
}

/** Deletes one of the edited glyph's located drawings. */
export async function deleteDrawing(editor: Editor, layerId: LayerId): Promise<void> {
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
