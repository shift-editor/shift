import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

describe("nudging points with the arrow keys", () => {
  it("moves every selected point by one unit as one undo step", async () => {
    const { a, b } = await editor.draw({
      contours: [
        {
          points: [
            { x: 10, y: 20, name: "a" },
            { x: 30, y: 40, name: "b" },
          ],
        },
      ],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([a, b]);
        await e.pressKey("ArrowRight");
      },
      { [a]: { x: 11, y: 20 }, [b]: { x: 31, y: 40 } },
    );
  });

  it("changes nothing when no point is selected", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            [10, 20],
            [30, 40],
          ],
        },
      ],
    });
    const before = await editor.outline();

    await editor.pressKey("ArrowRight");

    expect(await editor.outline()).toEqual(before);
  });
});
