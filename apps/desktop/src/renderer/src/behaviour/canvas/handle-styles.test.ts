import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

describe("point handles show selection at a source and plain styling between sources", () => {
  it("draws the selected handle as selected and the rest as idle", async () => {
    const { a, b, c } = await editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 100, name: "a" },
            { x: 150, y: 150, name: "b" },
            { x: 200, y: 200, name: "c" },
          ],
        },
      ],
    });
    editor.selectTool("select");

    editor.select([b]);

    expect(editor.drawnHandles()).toEqual([
      { pointId: a, state: "idle" },
      { pointId: b, state: "selected" },
      { pointId: c, state: "idle" },
    ]);
  });

  it("draws every handle of a contour selected whole as selected", async () => {
    editor.selectTool("shape");
    await editor.dragAt({ x: 10, y: 10 }, { x: 110, y: 90 });
    const [shape] = await editor.outline();
    expect(editor.selectionIds()).toEqual([shape?.id]);

    expect(editor.drawnHandles().map(({ state }) => state)).toEqual([
      "selected",
      "selected",
      "selected",
      "selected",
    ]);
  });

  it("draws every handle as interpolated between sources, and selection again back at a source", async () => {
    const { b } = await editor.draw({
      contours: [{ points: [[100, 100], { x: 150, y: 150, name: "b" }, [200, 200]] }],
    });
    editor.selectTool("select");
    editor.select([b]);
    await editor.addAxis("wght", 100, 400, 900);

    editor.moveToLocation({ wght: 550 });
    expect(editor.drawnHandles().map(({ state }) => state)).toEqual([
      "interpolated",
      "interpolated",
      "interpolated",
    ]);

    editor.openSource("Regular");
    expect(editor.drawnHandles()).toContainEqual({ pointId: b, state: "selected" });
  });
});
