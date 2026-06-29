import { BaseTool, type ToolName } from "../core/BaseTool";
import { TypingBehavior } from "./behaviors/TypingBehavior";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "@/types/editor";

export class TextTool extends BaseTool<TextState> {
  readonly id: ToolName = "text";
  readonly behaviors: TextBehavior[] = [new TypingBehavior()];

  override getCursor(state: TextState): CursorType {
    if (state.type === "typing") return { type: "text" };
    return { type: "default" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  override activate(): void {
    this.state = { type: "typing" };
  }

  override deactivate(): void {
    const run = this.editor.textRun;
    run.setCursorVisible(false);
    run.interaction.resume();
    this.state = { type: "idle" };
  }
}
