import { describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { ContourFixture } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("saving and reopening a document", () => {
  it("returns to clean when undo reaches the saved revision", async () => {
    await editor.save();

    editor.selectTool("pen");
    await editor.clickAt({ x: 100, y: 100 });
    await expect(editor.documentState()).resolves.toMatchObject({ dirty: true });

    await editor.undo();
    await expect(editor.documentState()).resolves.toMatchObject({ dirty: false });
  });

  // Corner `b` sits between `a` and `c`; the span from `a` to `b` is a line, a quadratic or a cubic.
  const spans = {
    line: [],
    quad: [{ x: 50, y: 100, off: true }],
    cubic: [
      { x: 33, y: 33, off: true },
      { x: 67, y: 67, off: true },
    ],
  } as const;
  const kept = {
    line: ["onCurve", "onCurve"],
    quad: ["onCurve", "offCurve", "onCurve"],
    cubic: ["onCurve", "offCurve", "offCurve", "onCurve"],
  } as const;

  it.each([
    ["fit", "line"],
    ["fit", "quad"],
    ["fit", "cubic"],
    ["gap", "line"],
  ] as const)("keeps a %s deletion of a %s span, ids and all", async (mode, span) => {
    const contour = {
      points: [{ x: 0, y: 0, name: "a" }, ...spans[span], { x: 100, y: 100, name: "b" }, [200, 0]],
    } satisfies ContourFixture;
    const { a, b } = await editor.draw({ contours: [contour] });

    await expectEdit(
      editor,
      async (e) => {
        e.select([b]);
        await e.deleteSelection(mode);
      },
      async (e) => {
        const outline = await e.outline();
        const points = outline.flatMap((each) => each.points);
        expect(points.map(({ id }) => id)).not.toContain(b);
        expect(points[0]?.id).toBe(a);
        if (mode === "fit") {
          expect(outline).toHaveLength(1);
          expect(points.map(({ pointType }) => pointType)).toEqual(kept[span]);
        } else {
          expect(outline.every((each) => each.points.length < 2)).toBe(true);
        }
      },
    );
  });

  it("reopens authored geometry and continues undoable editing", async () => {
    const { start, curve } = await editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 100, name: "start" },
            [300, 100],
            { x: 340, y: 180, off: true },
            { x: 460, y: 180, off: true },
            { x: 500, y: 100, smooth: true, name: "curve" },
            { x: 540, y: 20, off: true },
            { x: 660, y: 20, off: true },
            [700, 100],
          ],
        },
      ],
    });
    editor.setAdvanceWidth(700);
    await expect(editor.documentState()).resolves.toMatchObject({
      dirty: true,
      needsSaveAs: true,
    });
    await expect(editor.save()).resolves.toMatchObject({ dirty: false, needsSaveAs: false });

    await editor.dragPoint(start, { x: 40, y: 30 });
    editor.setAdvanceWidth(720);
    await expect(editor.documentState()).resolves.toMatchObject({ dirty: true });
    await expect(editor.save()).resolves.toMatchObject({ dirty: false });
    const saved = await editor.outline();
    expect((await editor.point(curve))?.smooth).toBe(true);

    const reopened = await editor.reopen();
    try {
      await expect(reopened.documentState()).resolves.toMatchObject({
        dirty: false,
        needsSaveAs: false,
      });
      expect(await reopened.outline()).toEqual(saved);
      expect(await reopened.advanceWidth()).toBe(720);

      await expectEdit(reopened, (e) => e.dragPoint(start, { x: 30, y: 20 }), {
        [start]: { x: 170, y: 150 },
      });
    } finally {
      await reopened.close();
    }
  });
});
