import type { Editor } from "@shift/editor";
import type { OutlineStrokeStyle } from "@shift/types";
import { notify } from "@/lib/notifications/notify";
import type {
  StrokeCommandId,
  StrokeCommandResult,
  StrokeExpandRequest,
  StrokeOffsetRequest,
} from "@/types/stroke";
import {
  applyDynamicStroke,
  expandStroke,
  expandStrokeWithStyle,
  offsetSelectedContour,
  removeDynamicStroke,
} from "./strokeCommands";

/**
 * Until the stroke panel supplies a style, the menu applies this one.
 *
 * @remarks
 * Interim choice: a round 20-unit stroke. The panel replaces it with the
 * user's own values.
 */
const MENU_STROKE_STYLE: OutlineStrokeStyle = {
  width: 20,
  cap: "round",
  join: "round",
  miterLimit: 4,
};

/** Menu "Expand stroke…" outlines the contour; the panel will expose the checkbox. */
const MENU_EXPAND_REQUEST: StrokeExpandRequest = { style: MENU_STROKE_STYLE, keepEditable: false };

const MENU_OFFSET_REQUEST: StrokeOffsetRequest = { distance: 10, join: "round", miterLimit: 4 };

/**
 * Runs a stroke command from the native menu, and tells the user why when it cannot run.
 *
 * @returns true when the command changed the document.
 */
export function runStrokeMenuCommand(editor: Editor, id: StrokeCommandId): boolean {
  const result = runStrokeCommandWithMenuDefaults(editor, id);
  if (result.ok) return true;

  notify(result.reason);
  return false;
}

function runStrokeCommandWithMenuDefaults(
  editor: Editor,
  id: StrokeCommandId,
): StrokeCommandResult {
  switch (id) {
    case "glyph.stroke.applyDynamic":
      return applyDynamicStroke(editor, MENU_STROKE_STYLE);

    case "glyph.stroke.expand":
      return expandStroke(editor);

    case "glyph.stroke.expandWithStyle":
      return expandStrokeWithStyle(editor, MENU_EXPAND_REQUEST);

    case "glyph.stroke.offsetContour":
      return offsetSelectedContour(editor, MENU_OFFSET_REQUEST);

    case "glyph.stroke.removeDynamic":
      return removeDynamicStroke(editor);
  }
}
