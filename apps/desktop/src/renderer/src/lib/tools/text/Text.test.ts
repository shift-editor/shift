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
    expect(editor.toolIf("text")?.state).toEqual({ type: "typing" });
    expect(editor.cursor).toBe("text");

    editor.escape();

    expect(editor.toolIf("text")).toBeNull();
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });
});
