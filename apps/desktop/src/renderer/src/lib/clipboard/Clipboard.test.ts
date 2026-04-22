import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Clipboard (via Editor)", () => {
  let editor: TestEditor;

  beforeEach(() => {
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("pen");

    // Draw a small rectangle: 4 points.
    editor.click(100, 100);
    editor.click(200, 100);
    editor.click(200, 200);
    editor.click(100, 200);
  });

  it("copy on empty selection returns false", async () => {
    editor.selection.clear();

    const ok = await editor.copy();

    expect(ok).toBe(false);
    expect(editor.clipboardBuffer).toBe("");
  });

  it("copy writes a shift/glyph-data payload to the clipboard", async () => {
    editor.selectAll();

    const ok = await editor.copy();

    expect(ok).toBe(true);
    const payload = JSON.parse(editor.clipboardBuffer);
    expect(payload.format).toBe("shift/glyph-data");
    expect(payload.content.contours).toHaveLength(1);
    expect(payload.content.contours[0].points).toHaveLength(4);
  });

  it("copy + paste duplicates the selected contour", async () => {
    editor.selectAll();
    const pointsBefore = editor.pointCount;

    await editor.copy();
    await editor.paste();

    expect(editor.pointCount).toBe(pointsBefore * 2);
  });

  it("cut removes the selected points from the glyph", async () => {
    editor.selectAll();
    expect(editor.pointCount).toBeGreaterThan(0);

    await editor.cut();

    expect(editor.pointCount).toBe(0);
  });

  it("paste with an empty clipboard is a no-op", async () => {
    editor.selection.clear();
    const pointsBefore = editor.pointCount;

    await editor.paste();

    expect(editor.pointCount).toBe(pointsBefore);
  });
});
