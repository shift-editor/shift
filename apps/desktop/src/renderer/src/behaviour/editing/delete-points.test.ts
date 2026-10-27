import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { square } from "@/testing/fixtures";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

describe("deleting points", () => {
  it("joins an open contour's neighbours across a deleted corner", async () => {
    const { a, b, c } = await editor.draw({
      contours: [
        {
          points: [
            { x: 0, y: 0, name: "a" },
            { x: 100, y: 50, name: "b" },
            { x: 200, y: 0, name: "c" },
          ],
        },
      ],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.select([b]);
        expect(await e.deleteSelection()).toBe(true);
      },
      async (e) => {
        expect(await e.outline()).toMatchObject([
          { closed: false, points: [{ id: a }, { id: c }] },
        ]);
      },
    );
  });

  it("keeps a closed contour closed when one corner goes", async () => {
    await editor.draw({ contours: [square(100)] });
    const [corner] = (await editor.outline())[0]!.points;

    await expectEdit(
      editor,
      async (e) => {
        e.select([corner!.id]);
        await e.deleteSelection();
      },
      async (e) => {
        const [contour] = await e.outline();
        expect(contour?.closed).toBe(true);
        expect(contour?.points.map(({ x, y }) => ({ x, y }))).toEqual([
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ]);
      },
    );
  });
});
