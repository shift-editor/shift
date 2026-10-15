import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { localPoint } from "@shift/editor/spaces";
import { TestEditor } from "@/testing/TestEditor";

describe("a glyph edited inside text takes the text's size", () => {
  let editor: TestEditor;
  let middleId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [, middleId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 300 },
      { x: 500, y: 100 },
    ]);
    editor.selectTool("select");
    editor.selection.clear();
    const run = editor.textRun!;
    editor.scene.updateNode({ id: run.id, size: run.size / 10 });
  });

  it("draws a tenth as large in text set at a tenth of the font's size", () => {
    const node = editor.runGlyph!;
    const origin = editor.toScene(node, localPoint(0, 0));
    const em = editor.toScene(node, localPoint(1000, 0));

    expect(em.x - origin.x).toBeCloseTo(100);
  });

  it("hits a point within the on-screen radius, measured in the glyph's own units", async () => {
    const node = editor.runGlyph!;
    const radius = editor.hitRadiusIn(node);
    expect(radius).toBeCloseTo(editor.hitRadius * 10);

    await editor.clickLocal(300 + radius / 2, 300);

    expect(editor.selection.has(middleId)).toBe(true);
  });
});
