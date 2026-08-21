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

  it("refuses contour commands without a valid contour selection", async () => {
    expect(await runRendererCommand(editor, "glyph.reverseSelectedContour")).toBe(false);
    expect(editor.glyphContours).toEqual([]);
  });

  it("ignores boolean operations with missing contour identities", () => {
    editor.boolean(mintContourId(), mintContourId(), "union");
    expect(editor.glyphContours).toEqual([]);
  });

  it("routes native Edit commands through the canvas editor", async () => {
    await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const originalPointCount = editor.pointCount;

    expect(await runRendererCommand(editor, "edit.selectAll")).toBe(true);
    expect(editor.selection.ids).toHaveLength(originalPointCount);
    expect(await runRendererCommand(editor, "edit.copy")).toBe(true);
    expect(editor.clipboardBuffer).not.toBe("");

    expect(await runRendererCommand(editor, "edit.paste")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor, "edit.undo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount);
    expect(await runRendererCommand(editor, "edit.redo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor, "edit.deleteSelection")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount);
    expect(await runRendererCommand(editor, "edit.undo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor, "edit.selectAll")).toBe(true);
    expect(await runRendererCommand(editor, "edit.cut")).toBe(true);
    expect(editor.pointCount).toBe(0);
    expect(await runRendererCommand(editor, "edit.undo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);
  });
});
