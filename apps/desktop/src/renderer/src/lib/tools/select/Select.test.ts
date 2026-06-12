import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

// Restored from the WS6 behavioral inventory (git show ef037c6e^).
describe("Select tool", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("select");
  });

  describe("selection", () => {
    it("selects a point when clicking on it", async () => {
      editor.selectTool("pen");
      editor.click(100, 200);
      await editor.settle();
      editor.selectTool("select");

      editor.click(100, 200);
      expect(editor.selection.pointIds.size).toBeGreaterThan(0);
    });

    it("clears selection when clicking empty space", async () => {
      editor.selectTool("pen");
      editor.click(100, 200);
      await editor.settle();
      editor.selectTool("select");

      editor.click(100, 200);
      editor.click(9999, 9999);
      expect(editor.selection.pointIds.size).toBe(0);
    });
  });
});
