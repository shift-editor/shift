import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Pen tool", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("pen");
  });

  describe("point creation", () => {
    it("adds a point on click", () => {
      editor.click(100, 200);
      expect(editor.pointCount).toBe(1);
    });

    it("adds multiple points", () => {
      editor.click(100, 200);
      editor.click(300, 400);
      expect(editor.pointCount).toBe(2);
    });
  });

  describe("state transitions", () => {
    it("starts in ready state after activation", () => {
      const state = editor.toolManager.activeTool?.getState();
      expect(state?.type).toBe("ready");
    });

    it("returns to ready after placing a point", () => {
      editor.click(100, 200);
      const state = editor.toolManager.activeTool?.getState();
      expect(state?.type).toBe("ready");
    });
  });

  describe("cancel", () => {
    it("handles escape in ready state without error", () => {
      editor.escape();
      const state = editor.toolManager.activeTool?.getState();
      expect(state?.type).toBe("ready");
    });
  });
});
