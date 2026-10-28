import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
  editor.selectTool("select");
});
afterEach(() => editor.close());

describe("duplicating the selection", () => {
  it("copies the selected points in place and selects the copy", async () => {
    const { first, second } = await editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 100, name: "first" },
            { x: 200, y: 100, name: "second" },
          ],
        },
      ],
    });
    editor.select([first, second]);

    expect(await editor.duplicate()).toBe(true);

    const [original, copy] = await editor.outline();
    expect(original?.points.map(({ id }) => id)).toEqual([first, second]);
    expect(copy?.points).toMatchObject([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    expect(editor.selectionIds()).toEqual(copy?.points.map(({ id }) => id));
  });
});
