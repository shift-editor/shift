import { BaseTool, type ToolName } from "../core/BaseTool";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "@/types/editor";
import { TypingBehavior } from "./behaviors/TypingBehaviour";

export class Text extends BaseTool<TextState> {
  readonly id: ToolName = "text";
  readonly behaviors: TextBehavior[] = [new TypingBehavior()];

  override getCursor(_state: TextState): CursorType {
    return { type: "text" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  override activate(): void {
    const activeName = this.editor.getActiveGlyphName();
    if (!activeName) {
      this.state = { type: "typing" };
      this.editor.setPreviewMode(true);
      return;
    }

    const activeUnicode = this.editor.getActiveGlyphUnicode();
    const run = this.editor.textRuns.switchTo(activeName);
    run.seed(
      { kind: "glyph", glyphName: activeName, codepoint: activeUnicode },
      this.editor.drawOffset.x,
    );
    run.interaction.suspend();
    run.setCursorVisible(true);

    this.state = { type: "typing" };
    this.editor.setPreviewMode(true);
  }

  override deactivate(): void {
    const run = this.editor.textRun;
    run.setCursorVisible(false);
    run.interaction.resume();
    this.editor.setPreviewMode(false);
    this.state = { type: "idle" };
  }
}

export default Text;
