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
    this.state = { type: "idle" };
    this.editor.setPreviewMode(true);
  }

  deactivate(): void {
    this.state = { type: "idle" };
    this.editor.setPreviewMode(false);
  }

  render(draw: DrawAPI): void {
    const glyph = this.editor.getGlyph();
    const metrics = this.editor.getFontMetrics();

    const start = { x: glyph.xAdvance, y: metrics.descender };
    const end = { x: glyph.xAdvance, y: metrics.ascender };

    draw.line(start, end, { strokeStyle: "#0C92F4", strokeWidth: 2 });

    const barTopS = { x: glyph.xAdvance - 20, y: metrics.ascender };
    const barTopE = { x: glyph.xAdvance + 20, y: metrics.ascender };
    draw.line(barTopS, barTopE, { strokeStyle: "#0C92F4", strokeWidth: 2.5 });

    const barBottomS = { x: glyph.xAdvance - 20, y: metrics.descender };
    const barBottomE = { x: glyph.xAdvance + 20, y: metrics.descender };
    draw.line(barBottomS, barBottomE, { strokeStyle: "#0C92F4", strokeWidth: 2.5 });
  }
}

export default TextTool;
