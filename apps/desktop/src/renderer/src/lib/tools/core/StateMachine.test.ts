import { describe, it, expect, vi } from "vitest";

import { createStateMachine } from "./StateMachine";

type TestState =
  | { type: "idle" }
  | { type: "loading"; progress: number }
  | { type: "success"; data: string }
  | { type: "error"; message: string };

describe("StateMachine", () => {
  describe("initial state", () => {
    it("should start with the initial state", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      expect(sm.current.type).toBe("idle");
    });

    it("should expose the initial state type via currentType", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      expect(sm.currentType).toBe("idle");
    });
  });

  describe("transition", () => {
    it("should change state when transitioning", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      sm.transition({ type: "loading", progress: 0 });
      expect(sm.current.type).toBe("loading");
    });

    it("should preserve state data after transition", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      sm.transition({ type: "loading", progress: 50 });
      expect(sm.current).toEqual({ type: "loading", progress: 50 });
    });

    it("should update the signal value", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      sm.transition({ type: "success", data: "hello" });
      expect(sm.state.value).toEqual({ type: "success", data: "hello" });
    });
  });

  describe("isIn", () => {
    it("should return true when in the specified state", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      expect(sm.isIn("idle")).toBe(true);
    });

    it("should return false when not in the specified state", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      expect(sm.isIn("loading")).toBe(false);
    });

    it("should return true when in any of the specified states", () => {
      const sm = createStateMachine<TestState>({
        type: "loading",
        progress: 50,
      });
      expect(sm.isIn("idle", "loading")).toBe(true);
    });

    it("should return false when not in any of the specified states", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      expect(sm.isIn("loading", "success", "error")).toBe(false);
    });
  });

  describe("when", () => {
    it("should call handler when in the matching state", () => {
      const sm = createStateMachine<TestState>({
        type: "loading",
        progress: 75,
      });
      const handler = vi.fn();

      sm.when("loading", handler);

      expect(handler).toHaveBeenCalledWith({ type: "loading", progress: 75 });
    });

    it("should not call handler when not in the matching state", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });
      const handler = vi.fn();

      sm.when("loading", handler);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should provide typed state to handler", () => {
      const sm = createStateMachine<TestState>({
        type: "success",
        data: "test data",
      });

      sm.when("success", (state) => {
        expect(state.data).toBe("test data");
      });
    });
  });

  describe("match", () => {
    it("should call the matching handler and return its result", () => {
      const sm = createStateMachine<TestState>({
        type: "loading",
        progress: 50,
      });

      const result = sm.match({
        idle: () => "was idle",
        loading: (state) => `progress: ${state.progress}`,
        success: (state) => state.data,
        error: (state) => state.message,
      });

      expect(result).toBe("progress: 50");
    });

    it("should return undefined if no handler matches", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });

      const result = sm.match({
        loading: () => "loading",
      });

      expect(result).toBeUndefined();
    });

    it("should work with partial handlers", () => {
      const sm = createStateMachine<TestState>({
        type: "success",
        data: "hello",
      });

      const result = sm.match({
        success: (state) => state.data.toUpperCase(),
      });

      expect(result).toBe("HELLO");
    });
  });

  describe("state signal integration", () => {
    it("should expose the underlying signal for reactive use", () => {
      const sm = createStateMachine<TestState>({ type: "idle" });

      expect(sm.state.value.type).toBe("idle");

      sm.transition({ type: "loading", progress: 0 });

      expect(sm.state.value.type).toBe("loading");
    });
  });
});
