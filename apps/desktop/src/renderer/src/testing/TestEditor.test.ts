import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "./TestEditor";

describe("TestEditor", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
  });

  describe("pointerMove", () => {
    it("drives the tool pipeline synchronously via the flush seam", () => {
      editor.selectTool("pen");

      // Two distinct moves must both register synchronously — a single-flush
      // rAF implementation would coalesce them and only the latest would land.
      editor.pointerMove(100, 100);
      const first = editor.getActiveToolState().mousePos;

      editor.pointerMove(200, 200);
      const second = editor.getActiveToolState().mousePos;

      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second).not.toEqual(first);
    });
  });
});
