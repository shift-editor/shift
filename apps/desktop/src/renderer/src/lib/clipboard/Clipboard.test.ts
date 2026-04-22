import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

/**
 * Stubs the Electron clipboard IPC with an in-memory buffer so copy/cut/paste
 * can round-trip in the test process. Real electronAPI is undefined in Node.
 */
function stubElectronClipboard() {
  let buffer = "";
  vi.stubGlobal("window", {
    ...globalThis.window,
    electronAPI: {
      clipboardWriteText: (text: string) => {
        buffer = text;
      },
      clipboardReadText: () => buffer,
    },
  });
}

describe("Clipboard (via Editor)", () => {
  let editor: TestEditor;

  beforeEach(() => {
    stubElectronClipboard();
    editor = new TestEditor();
    editor.startSession();
    editor.selectTool("pen");

    // Draw a small rectangle: 4 points.
    editor.click(100, 100);
    editor.click(200, 100);
    editor.click(200, 200);
    editor.click(100, 200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copy on empty selection returns false and writes nothing", async () => {
    editor.selection.clear();

    const ok = await editor.copy();

    expect(ok).toBe(false);
  });

  it("copy + paste duplicates the selected contour with the default paste offset", async () => {
    editor.selectAll();
    const pointsBefore = editor.pointCount;

    await editor.copy();
    await editor.paste();

    expect(editor.pointCount).toBe(pointsBefore * 2);
  });

  it("cut removes the selected points from the glyph", async () => {
    editor.selectAll();
    const pointsBefore = editor.pointCount;
    expect(pointsBefore).toBeGreaterThan(0);

    await editor.cut();

    expect(editor.pointCount).toBe(0);
  });

  it("paste with nothing on the clipboard is a no-op", async () => {
    editor.selection.clear();
    const pointsBefore = editor.pointCount;

    await editor.paste();

    expect(editor.pointCount).toBe(pointsBefore);
  });
});
