import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Pen in a glyph edited inside scaled text", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    const run = editor.textRun!;
    editor.scene.updateNode({ id: run.id, size: run.size / 10 });
  });

  it("closes the contour on a click within the on-screen radius of its start", async () => {
    await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    // Beyond the radius at the font's own size, within it at a tenth of the size.
    const gap = editor.hitRadiusIn(editor.runGlyph!) / 2;
    expect(gap).toBeGreaterThan(editor.hitRadius);

    await editor.clickLocal(100 + gap, 100 + gap);

    const contour = editor.glyphContours[0];
    expect(editor.glyphContours).toHaveLength(1);
    expect(contour?.closed).toBe(true);
    expect(contour?.points).toHaveLength(3);
  });
});
