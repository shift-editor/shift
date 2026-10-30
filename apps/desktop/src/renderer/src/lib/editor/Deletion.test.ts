import { describe, expect, it } from "vitest";
import { cubic } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("GlyphLayer.deletePoints", () => {
  it("publishes the same complete topology locally and after the workspace echo", async () => {
    await editor.draw({ contours: [cubic([0, 0], [0, 100], [200, 100], [200, 0])] });
    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 75 });
    const split = await editor.pointAt({ x: 100, y: 75 });
    if (!split) throw new Error("Expected the split point");
    editor.selectTool("select");
    editor.select([split.id]);

    const deleting = editor.deleteSelection();
    await expect.poll(() => editor.drawnPoint(split.id)).toBeNull();
    const local = editor.drawnOutline();
    expect(editor.editorView().applyStatus).not.toBe("idle");
    expect(local).toMatchObject([{ points: Array(4).fill({}) }]);
    expect(editor.drawnPoint(split.id)).toBeNull();
    await deleting;
    await editor.settle();
    expect(await editor.outline()).toEqual(local);
  });
});
