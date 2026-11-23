import type { Editor } from "@shift/editor";
import { signal, type WritableSignal } from "@shift/editor/signals";
import type { ContourId, OutlineStrokeStyle } from "@shift/types";

export interface PresetCommandResult {
  readonly ok: true;
  readonly presetId: string;
}

export interface PresetCommandRefusal {
  readonly ok: false;
  readonly reason: string;
}

export type StrokePresetCommandResult = PresetCommandResult | PresetCommandRefusal;

function refused(reason: string): PresetCommandRefusal {
  return { ok: false, reason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The stroke style most recently copied with {@link copyStrokeStyle}, or `null`
 * when nothing has been copied yet.
 *
 * Reactive: the StrokeMenu reads it to enable/disable "Paste Stroke Style".
 */
export const copiedStrokeStyleCell: WritableSignal<OutlineStrokeStyle | null> = signal(null);

/**
 * Saves `style` as a named stroke preset and returns the minted id.
 *
 * Returns a refusal when the name is blank or the font is read-only.
 */
export function saveAsStrokePreset(
  editor: Editor,
  name: string,
  style: OutlineStrokeStyle,
): StrokePresetCommandResult {
  const trimmed = name.trim();
  if (!trimmed) return refused("Preset name must not be blank.");
  if (editor.font.refusesEdits) return refused("The font is not editable.");

  try {
    let presetId = "";
    editor.transaction("Save stroke preset", () => {
      presetId = editor.font.createStrokePreset(trimmed, style);
    });

    return { ok: true, presetId };
  } catch (error) {
    return refused(`Save stroke preset failed: ${errorMessage(error)}`);
  }
}

/**
 * Applies a named stroke preset to the selected contours.
 *
 * Each contour records the preset id so it tracks the preset's style.
 * Returns a refusal when no editable layer is found, the selection is
 * empty, or the preset id is unknown.
 */
export function applyStrokePreset(editor: Editor, presetId: string): StrokePresetCommandResult {
  if (editor.font.refusesEdits) return refused("The font is not editable.");

  const preset = editor.font.strokePresetsCell.peek().find((p) => p.id === presetId);
  if (!preset) return refused(`Stroke preset "${presetId}" not found.`);

  // Collect the contour ids touched by the selection.
  const seen = new Set<ContourId>();
  for (const obj of editor.objects(editor.selection.ids)) {
    switch (obj.kind) {
      case "point":
      case "segment":
      case "contour":
        seen.add(obj.contourId);
        break;

      default:
        break;
    }
  }

  const contourIds = [...seen];
  if (contourIds.length === 0) return refused("Select contours to apply the preset to.");

  const layer = editor.layerForGeometry({ contours: contourIds });
  if (!layer) return refused("Select contours that belong to one editable layer.");

  try {
    editor.transaction("Apply stroke preset", () => {
      layer.setLiveStroke(contourIds, preset.style, presetId);
    });

    return { ok: true, presetId };
  } catch (error) {
    return refused(`Apply stroke preset failed: ${errorMessage(error)}`);
  }
}

/**
 * Renames a stroke preset.
 *
 * Returns a refusal when the name is blank, the preset id is unknown, or the
 * font is read-only.
 */
export function renameStrokePreset(
  editor: Editor,
  presetId: string,
  name: string,
): StrokePresetCommandResult {
  const trimmed = name.trim();
  if (!trimmed) return refused("Preset name must not be blank.");
  if (editor.font.refusesEdits) return refused("The font is not editable.");

  const exists = editor.font.strokePresetsCell.peek().some((p) => p.id === presetId);
  if (!exists) return refused(`Stroke preset "${presetId}" not found.`);

  try {
    editor.transaction("Rename stroke preset", () => {
      editor.font.renameStrokePreset(presetId, trimmed);
    });

    return { ok: true, presetId };
  } catch (error) {
    return refused(`Rename stroke preset failed: ${errorMessage(error)}`);
  }
}

/**
 * Deletes a stroke preset.
 *
 * Contours that referenced it keep their inline style but lose the preset link.
 * Returns a refusal when the preset id is unknown or the font is read-only.
 */
export function deleteStrokePreset(editor: Editor, presetId: string): StrokePresetCommandResult {
  if (editor.font.refusesEdits) return refused("The font is not editable.");

  const exists = editor.font.strokePresetsCell.peek().some((p) => p.id === presetId);
  if (!exists) return refused(`Stroke preset "${presetId}" not found.`);

  try {
    editor.transaction("Delete stroke preset", () => {
      editor.font.deleteStrokePreset(presetId);
    });

    return { ok: true, presetId };
  } catch (error) {
    return refused(`Delete stroke preset failed: ${errorMessage(error)}`);
  }
}

/**
 * Copies the stroke style of the first selected dynamic contour into
 * {@link copiedStrokeStyleCell}.
 *
 * Returns a refusal when no dynamic stroke is selected.
 */
export function copyStrokeStyle(editor: Editor): StrokePresetCommandResult {
  const { font } = editor;

  // Collect selected contour ids first; layer resolution requires them.
  const seen = new Set<ContourId>();
  for (const obj of editor.objects(editor.selection.ids)) {
    switch (obj.kind) {
      case "point":
      case "segment":
      case "contour":
        seen.add(obj.contourId);
        break;

      default:
        break;
    }
  }

  if (seen.size === 0) return refused("Select a contour with a dynamic stroke to copy.");

  const layer = editor.layerForGeometry({ contours: [...seen] });
  if (!layer) return refused("Select contours that belong to one editable layer.");

  const strokes = font.liveStrokes(layer.id);
  const [first] = strokes.filter((s) => seen.has(s.contourId));
  if (!first) return refused("No dynamic stroke in the selection to copy.");

  copiedStrokeStyleCell.set(first.style);

  return { ok: true, presetId: "" };
}

/**
 * Applies the previously copied stroke style to the selected contours.
 *
 * Returns a refusal when nothing has been copied or the selection has no
 * editable layer.
 */
export function pasteStrokeStyle(editor: Editor): StrokePresetCommandResult {
  const style = copiedStrokeStyleCell.peek();
  if (!style) return refused("Copy a stroke style first.");
  if (editor.font.refusesEdits) return refused("The font is not editable.");

  const seen = new Set<ContourId>();
  for (const obj of editor.objects(editor.selection.ids)) {
    switch (obj.kind) {
      case "point":
      case "segment":
      case "contour":
        seen.add(obj.contourId);
        break;

      default:
        break;
    }
  }

  const contourIds = [...seen];
  if (contourIds.length === 0) return refused("Select contours to paste the stroke style to.");

  const layer = editor.layerForGeometry({ contours: contourIds });
  if (!layer) return refused("Select contours that belong to one editable layer.");

  try {
    editor.transaction("Paste stroke style", () => {
      layer.setLiveStroke(contourIds, style);
    });

    return { ok: true, presetId: "" };
  } catch (error) {
    return refused(`Paste stroke style failed: ${errorMessage(error)}`);
  }
}
