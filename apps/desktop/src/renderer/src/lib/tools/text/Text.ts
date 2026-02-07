import { BaseTool, ToolName } from "../core/BaseTool";
import { TextState } from "./types";
import { ToolEvent } from "../core/GestureDetector";

class TextTool extends BaseTool<TextState> {
  readonly id: ToolName = "text";

  initialState(): TextState {
    return { type: "idle" };
  }

  transition(state: TextState, _event: ToolEvent): TextState {
    return state;
  }

  onTransition(_prev: TextState, _next: TextState, _event: ToolEvent): void {}

  activate(): void {
    this.state = { type: "idle" };
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }
}

export default TextTool;
