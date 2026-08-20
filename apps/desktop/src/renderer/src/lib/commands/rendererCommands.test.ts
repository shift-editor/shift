import { beforeEach, describe, expect, it } from "vitest";
import { mintContourId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { runRendererCommand } from "./rendererCommands";

describe("empty and invalid editor operations", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession("empty", null);
  });

  it("refuses clipboard mutations without selected content", async () => {
    expect(await editor.copy()).toBe(false);
    expect(await editor.cut()).toBe(false);
    expect(await editor.paste()).toBe(false);
    expect(editor.clipboardBuffer).toBe("");
    expect(editor.pointCount).toBe(0);
  });

  it("refuses deletion and duplication without selected geometry", async () => {
    expect(await editor.deleteSelection()).toBe(false);
    expect(editor.duplicateSelection()).toEqual([]);
    expect(editor.pointCount).toBe(0);
  });

  it("refuses contour commands without a valid contour selection", () => {
    expect(runRendererCommand(editor, "glyph.reverseSelectedContour")).toBe(false);
    expect(editor.glyphContours).toEqual([]);
  });

  it("ignores boolean operations with missing contour identities", () => {
    editor.boolean(mintContourId(), mintContourId(), "union");
    expect(editor.glyphContours).toEqual([]);
  });
});
