import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Select tool", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("select");
  });

  describe("selection", () => {
    it("selects a point when clicking on it", () => {
      editor.selectTool("pen");
      editor.click(100, 200);
      editor.selectTool("select");

      editor.click(100, 200);
      expect(editor.getSelectedPoints().length).toBeGreaterThan(0);
    });

    it("clears selection when clicking empty space", () => {
      editor.selectTool("pen");
      editor.click(100, 200);
      editor.selectTool("select");

      editor.click(100, 200);
      editor.click(9999, 9999);
      expect(editor.getSelectedPoints().length).toBe(0);
    });
  });
});
