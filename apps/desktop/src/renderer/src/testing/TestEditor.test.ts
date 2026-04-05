import { describe, it, expect } from "vitest";
import { TestEditor } from "./TestEditor";

describe("TestEditor", () => {
  it("creates an editor with a mock engine", () => {
    const editor = new TestEditor();
    expect(editor).toBeDefined();
    expect(editor.mockEngine).toBeDefined();
  });

  it("can start an edit session", () => {
    const editor = new TestEditor();
    editor.startSession("A");
    expect(editor.currentGlyph).not.toBeNull();
  });

  it("can add points via the pen tool", () => {
    const editor = new TestEditor();
    editor.startSession("A");
    editor.selectTool("pen");

    expect(editor.pointCount).toBe(0);

    editor.click(100, 200);
    expect(editor.pointCount).toBe(1);

    editor.click(300, 400);
    expect(editor.pointCount).toBe(2);
  });
});
