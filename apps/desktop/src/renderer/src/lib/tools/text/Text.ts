import { BaseTool, ToolName } from "../core/BaseTool";
import { TextAction, TextBehavior, TextState } from "./types";
import { CursorType } from "@/types/editor";
import { DrawAPI } from "../core/DrawAPI";
import { TypingBehavior } from "./behaviors/TypingBehaviour";

class TextTool extends BaseTool<TextState, TextAction> {
  readonly id: ToolName = "text";

  readonly behaviors: TextBehavior[] = [new TypingBehavior()];

  getCursor(_state: TextState): CursorType {
    return { type: "text" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  activate(): void {
    this.state = {
      type: "typing",
      layout: { slots: [], totalAdvance: 0 },
    };
    this.editor.setPreviewMode(true);
  }

  deactivate(): void {
    this.state = { type: "idle" };
    this.editor.setPreviewMode(false);
    this.editor.setDrawOffset({ x: 0, y: 0 });
  }

  protected executeAction(action: TextAction, _prev: TextState): void {
    switch (action.type) {
      case "moveLeft":
        // move cursor left
        break;
      case "moveRight":
        // move cursor right
        break;
      case "delete":
        // delete character at cursor position
        break;
      case "cancel":
        // cancel typing
        break;
      case "insert":
        // insert character at cursor position
        break;
    }
  }

  render(draw: DrawAPI): void {
    const glyph = this.editor.glyph.peek();
    const randomGlyph = this.editor.font.getSvgPath(101);

    this.editor.setDrawOffset({ x: -200, y: 0 });
    const metrics = this.editor.font.getMetrics();
    draw.svgPath(randomGlyph, 70, glyph.xAdvance, 0, { fillStyle: "black" });

    const start = { x: glyph.xAdvance, y: metrics.descender };
    const end = { x: glyph.xAdvance, y: metrics.ascender };

    draw.line(start, end, { strokeStyle: "#0C92F4", strokeWidth: 1.25 });

    const barTopS = { x: glyph.xAdvance - 20, y: metrics.ascender };
    const barTopE = { x: glyph.xAdvance + 20, y: metrics.ascender };
    draw.line(barTopS, barTopE, { strokeStyle: "#0C92F4", strokeWidth: 1.25 });

    const barBottomS = { x: glyph.xAdvance - 20, y: metrics.descender };
    const barBottomE = { x: glyph.xAdvance + 20, y: metrics.descender };
    draw.line(barBottomS, barBottomE, { strokeStyle: "#0C92F4", strokeWidth: 1.25 });
  }
}

export default TextTool;
