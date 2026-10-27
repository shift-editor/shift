import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

describe("adding a point on a segment with the Pen", () => {
  it("splits a line with one corner where it is clicked, as one undo step", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            [0, 0],
            [100, 0],
          ],
        },
      ],
    });
    editor.selectTool("pen");

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 50, y: 0 }),
      async (e) => {
        const [contour] = await e.outline();
        expect(contour?.points).toHaveLength(3);
        expect(await e.pointAt({ x: 50, y: 0 })).toMatchObject({ pointType: "onCurve" });
      },
    );
  });

  it("splits a line at the clicked fraction of its length", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            [0, 0],
            [100, 100],
          ],
        },
      ],
    });
    editor.selectTool("pen");

    await editor.clickAt({ x: 25, y: 25 });

    expect(await editor.pointAt({ x: 25, y: 25 })).toMatchObject({ pointType: "onCurve" });
  });

  it("splits a cubic into two with a smooth point between, as one undo step", async () => {
    await editor.draw({
      contours: [
        {
          points: [[0, 0], { x: 25, y: 100, off: true }, { x: 75, y: 100, off: true }, [100, 0]],
        },
      ],
    });
    editor.selectTool("pen");

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 50, y: 75 }),
      async (e) => {
        const [contour] = await e.outline();
        expect(contour?.points.map(({ pointType }) => pointType)).toEqual([
          "onCurve",
          "offCurve",
          "offCurve",
          "onCurve",
          "offCurve",
          "offCurve",
          "onCurve",
        ]);
        expect(contour?.points[3]).toMatchObject({ smooth: true });
      },
    );
  });

  it("splits a quadratic into two quadratics, as one undo step", async () => {
    await editor.draw({
      contours: [
        { points: [[0, 0], { x: 50, y: 100, off: true }, { x: 100, y: 0, qCurve: true }] },
      ],
    });
    expect((await editor.outline())[0]?.points.map(({ pointType }) => pointType)).toEqual([
      "onCurve",
      "offCurve",
      "qCurve",
    ]);
    editor.selectTool("pen");

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 50, y: 50 }),
      async (e) => {
        const [contour] = await e.outline();
        expect(contour?.points.map(({ pointType }) => pointType)).toEqual([
          "onCurve",
          "offCurve",
          "qCurve",
          "offCurve",
          "qCurve",
        ]);
      },
    );
  });
});
