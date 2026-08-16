import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Text tool", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("text");
  });

  it("publishes typing until Escape returns to Select", () => {
    const text = editor.toolManager.activeTool;
    if (!text) throw new Error("Expected active Text tool");

    expect(text.getState()).toEqual({ type: "typing" });
    expect(text.stateCell.value).toEqual({ type: "typing" });
    expect(editor.getActiveToolState()).toEqual({ type: "typing" });
    expect(editor.cursor).toBe("text");

    editor.escape();

    expect(editor.toolManager.activeToolId).toBe("select");
    expect(editor.getActiveToolState()).toEqual({ type: "ready" });
    expect(text.getState()).toEqual({ type: "idle" });
    expect(text.stateCell.value).toEqual({ type: "idle" });
  });
});
