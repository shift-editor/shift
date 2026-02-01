import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseTool } from "./BaseTool";
import type { ToolContext } from "./ToolContext";
import type { ToolEvent } from "./GestureDetector";
import type { ToolName } from "./createContext";
import { createMockToolContext } from "@/testing";

type ContractState = { type: "idle" } | { type: "ready" };

class ContractTestTool extends BaseTool<ContractState> {
  readonly id: ToolName = "select";
  onTransition = vi.fn();

  initialState(): ContractState {
    return { type: "idle" };
  }

  transition(state: ContractState, event: ToolEvent): ContractState {
    if (state.type === "idle" && event.type === "click") return { type: "ready" };
    return state;
  }
}

describe("BaseTool contract", () => {
  let ctx: ToolContext;
  let tool: ContractTestTool;
  let setActiveToolStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctx = createMockToolContext();
    setActiveToolStateSpy = vi.spyOn(ctx, "setActiveToolState");
    tool = new ContractTestTool(ctx);
    tool.onTransition.mockClear();
  });

  describe("lifecycle when state changes", () => {
    it("calls setActiveToolState with next state and onTransition with prev, next, event", () => {
      const clickEvent: ToolEvent = {
        type: "click",
        point: { x: 10, y: 10 },
        shiftKey: false,
        altKey: false,
      };

      tool.handleEvent(clickEvent);

      expect(setActiveToolStateSpy).toHaveBeenCalledTimes(1);
      expect(setActiveToolStateSpy).toHaveBeenCalledWith({ type: "ready" });
      expect(tool.onTransition).toHaveBeenCalledTimes(1);
      expect(tool.onTransition).toHaveBeenCalledWith(
        { type: "idle" },
        { type: "ready" },
        clickEvent,
      );
      expect(tool.getState()).toEqual({ type: "ready" });
    });
  });

  describe("lifecycle when state is unchanged (same reference)", () => {
    it("does not call onTransition when transition returns same state reference", () => {
      const moveEvent: ToolEvent = {
        type: "pointerMove",
        point: { x: 10, y: 10 },
      };

      tool.handleEvent(moveEvent);

      expect(setActiveToolStateSpy).not.toHaveBeenCalled();
      expect(tool.onTransition).not.toHaveBeenCalled();
      expect(tool.getState()).toEqual({ type: "idle" });
    });

    it("does not call onTransition when transition returns same state after ready", () => {
      tool.handleEvent({
        type: "click",
        point: { x: 0, y: 0 },
        shiftKey: false,
        altKey: false,
      });
      setActiveToolStateSpy.mockClear();
      tool.onTransition.mockClear();

      tool.handleEvent({
        type: "pointerMove",
        point: { x: 5, y: 5 },
      });

      expect(setActiveToolStateSpy).not.toHaveBeenCalled();
      expect(tool.onTransition).not.toHaveBeenCalled();
    });
  });
});
