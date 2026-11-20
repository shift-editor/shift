import type { Editor } from "@shift/editor";
import { notify } from "@/lib/notifications/notify";
import type { StrokeCommandResult, StrokeMenuCommandId } from "@/types/stroke";
import { applyDynamicStroke, expandStroke, removeDynamicStroke } from "./strokeCommands";

/**
 * Runs a stroke command from the native menu, and tells the user why when it cannot run.
 *
 * Offset Contour… is not here: it needs a distance, so it opens its dialog instead.
 *
 * @returns true when the command changed the document.
 */
export function runStrokeMenuCommand(editor: Editor, id: StrokeMenuCommandId): boolean {
  const result = runStrokeCommandWithMenuDefaults(editor, id);
  if (result.ok) return true;

  notify(result.reason);
  return false;
}

function runStrokeCommandWithMenuDefaults(
  editor: Editor,
  id: StrokeMenuCommandId,
): StrokeCommandResult {
  switch (id) {
    case "glyph.stroke.applyDynamic":
      return applyDynamicStroke(editor);

    case "glyph.stroke.expand":
      return expandStroke(editor);

    case "glyph.stroke.removeDynamic":
      return removeDynamicStroke(editor);
  }
}
