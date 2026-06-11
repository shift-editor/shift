import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "./TestEditor";

describe("TestEditor", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  describe("pointerMove", () => {
    it("flushes pointer input synchronously", () => {
      editor.selectTool("pen");

      // Two distinct moves must both register synchronously. Without the
      // explicit flush seam, these would be coalesced behind rAF and tests
      // would observe stale pointer input.
      editor.pointerMove(100, 100);
      const first = editor.input.pointer;

      editor.pointerMove(200, 200);
      const second = editor.input.pointer;

      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second).not.toEqual(first);
    });
  });
});
