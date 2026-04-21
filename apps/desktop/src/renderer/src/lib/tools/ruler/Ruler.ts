import { CursorType } from "@/types/editor";
import { BaseTool, ToolName } from "../core/BaseTool";
import { RulerState } from "./types";

export class Ruler extends BaseTool<RulerState> {
  readonly id: ToolName = "ruler";

  readonly behaviors = [];

  initialState(): RulerState {
    return { type: "idle" };
  }

  getCursor(): CursorType {
    return { type: "crosshair" };
  }
}
