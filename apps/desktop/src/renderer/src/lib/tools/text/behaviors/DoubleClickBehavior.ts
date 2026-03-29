import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TextState, TextBehavior } from "../types";
import { hitTestLayoutAt } from "../TextLayout";

export class DoubleClickBehavior implements TextBehavior {
  canHandle(state: TextState, event: ToolEvent): boolean {
    return state.type === "typing" && event.type === "doubleClick";
  }

  transition(state: TextState, event: ToolEvent, editor: ToolContext): TextState | null {
    if (event.type !== "doubleClick" || state.type !== "typing") return null;

    const metrics = editor.getFontMetrics();
    const glyphIndex = hitTestLayoutAt(state.layout, metrics, event.point);
    if (glyphIndex === null) return null;

    const glyph = state.layout[glyphIndex];
    return {
      type: "editing-glyph",
      text: state.text,
      cursorIndex: state.cursorIndex,
      layout: state.layout,
      editingIndex: glyphIndex,
      originalUnicode: glyph.unicode,
    };
  }
}
