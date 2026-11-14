import { describe, expect, it } from "vitest";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("the font keeps its grid", () => {
  it("draws a new font on 100-unit cells", () => {
    expect(editor.gridSettings()).toMatchObject({ spacingX: 100, spacingY: 100, subdivisions: 1 });
  });

  it("shows a changed grid at once, before the font echoes it back", () => {
    editor.setGrid({ spacingX: 50, subdivisions: 2 });

    expect(editor.gridSettings()).toMatchObject({ spacingX: 50, spacingY: 100, subdivisions: 2 });
  });

  it("changes the grid as one undoable step", async () => {
    editor.setGrid({ spacingX: 50, spacingY: 50 });
    await editor.settle();
    editor.setGrid({ subdivisions: 5 });
    await editor.settle();

    await editor.undo();
    expect(editor.gridSettings()).toMatchObject({ spacingX: 50, spacingY: 50, subdivisions: 1 });
    await editor.undo();
    expect(editor.gridSettings()).toMatchObject({ spacingX: 100, spacingY: 100, subdivisions: 1 });
    await editor.redo();
    expect(editor.gridSettings()).toMatchObject({ spacingX: 50, spacingY: 50, subdivisions: 1 });
  });

  it("keeps the cells when the document is saved and reopened, but not whether it shows", async () => {
    editor.setGrid({ spacingX: 40, spacingY: 60, subdivisions: 4, visible: true, snap: true });
    await editor.settle();

    const reopened = await editor.reopen();
    try {
      expect(reopened.gridSettings()).toEqual({
        spacingX: 40,
        spacingY: 60,
        subdivisions: 4,
        visible: false,
        snap: false,
      });
    } finally {
      await reopened.close();
    }
  });

  it("does not make an undo step for showing the grid or snapping to it", async () => {
    editor.setGrid({ spacingX: 25 });
    await editor.settle();
    editor.setGrid({ visible: true, snap: true });
    await editor.settle();

    await editor.undo();

    expect(editor.gridSettings()).toMatchObject({ spacingX: 100, visible: true, snap: true });
  });
});
