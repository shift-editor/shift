import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TextState, TextBehavior } from "../types";
import { hitTestLayoutAt, layoutBounds } from "../TextLayout";

export class ClickBehavior implements TextBehavior {
  canHandle(state: TextState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "typing") && event.type === "click";
  }

  transition(state: TextState, event: ToolEvent, editor: ToolContext): TextState | null {
    if (event.type !== "click") return null;

    if (state.type === "ready") {
      return { type: "typing", text: "", cursorIndex: 0, layout: [] };
    }

    if (state.type === "typing") {
      const metrics = editor.getFontMetrics();
      const bounds = layoutBounds(state.layout, metrics);
      if (!bounds) return null;

      if (
        event.point.y < bounds.y ||
        event.point.y > bounds.y + bounds.height
      ) {
        return null;
      }

      if (event.point.x < bounds.x) {
        return { ...state, cursorIndex: 0 };
      }

      const lastGlyph = state.layout[state.layout.length - 1];
      if (event.point.x >= lastGlyph.xOffset + lastGlyph.advance) {
        return { ...state, cursorIndex: state.layout.length };
      }

      const hit = hitTestLayoutAt(state.layout, metrics, event.point);
      if (hit !== null) {
        const glyph = state.layout[hit];
        const glyphCenter = glyph.xOffset + glyph.advance / 2;
        const cursorIndex = event.point.x < glyphCenter ? hit : hit + 1;
        return { ...state, cursorIndex };
      }
      return null;
    }

    return null;
  }
}
