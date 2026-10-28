import { beforeEach, describe, expect, it } from "vitest";
import { LOCK_GAP_PX, LOCK_SIZE_PX } from "@shift/editor/rendering";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ mode: "preview" });
beforeEach(async () => {
  await editor.draw({
    contours: [line([100, 100], [200, 200])],
  });
  editor.selectTool("select");
});

describe("a preview session only looks", () => {
  it("disables the authoring tools but keeps Select and Text", () => {
    expect(editor.toolDisabled("select")).toBe(false);
    expect(editor.toolDisabled("text")).toBe(false);
    expect(editor.toolDisabled("pen")).toBe(true);
    expect(editor.toolDisabled("shape")).toBe(true);
  });

  it("types proof text with the Text tool", async () => {
    editor.selectTool("text");

    await editor.typeText("AA");

    expect(editor.toolState()?.state).toBe("editing");
    expect(editor.canvasText()?.items.length).toBe(3);
  });

  it("neither hovers, selects nor marquees", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    expect(editor.selectionIds()).toEqual([]);

    editor.movePointerTo({ x: 100, y: 100 });
    expect(editor.hoveredId()).toBeNull();

    await editor.dragFrom({ x: 80, y: 80 }, { x: 150, y: 150 });
    expect(editor.selectionIds()).toEqual([]);
    expect(editor.toolState()?.state).toBe("ready");
  });

  it("treats a click on the preview lock as a click on empty canvas", async () => {
    const pixel = editor.pixelSize();
    const lock = {
      x: (await editor.advanceWidth()) / 2,
      y: editor.metrics().descender - (LOCK_GAP_PX + LOCK_SIZE_PX / 2) * pixel,
    };

    expect(editor.targetAt(lock)).toBe("canvas");
    await editor.clickAt(lock);

    expect(editor.selectionIds()).toEqual([]);
    expect(editor.toolState()?.state).toBe("ready");
  });
});
