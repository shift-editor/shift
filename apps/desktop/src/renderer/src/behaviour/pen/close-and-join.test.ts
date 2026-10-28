import { beforeEach, describe, expect, it } from "vitest";
import { cursorToCSS } from "@shift/editor/rendering";
import { expectEdit } from "@/testing/expectEdit";
import { line } from "@/testing/fixtures";
import { offCurve, onCurve } from "@/testing/outlineMatchers";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("pen");
});

/** Clicks out an open corner contour with the Pen, leaving its stroke active. */
async function drawStroke(): Promise<void> {
  await editor.clickAt({ x: 100, y: 100 });
  await editor.clickAt({ x: 300, y: 100 });
  await editor.clickAt({ x: 300, y: 300 });
}

describe("closing a contour by dragging off its first point", () => {
  it("closes a line-started contour with a smooth start along the line's tangent, as one undoable step", async () => {
    await drawStroke();

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 100, y: 100 }, { x: 160, y: 130 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            closed: true,
            points: [
              { ...onCurve(100, 100), smooth: true },
              onCurve(300, 100),
              onCurve(300, 300),
              { pointType: "offCurve" },
              offCurve(40, 100),
            ],
          },
        ]);
      },
    );
  });

  it("mirrors the first handle of a curve-started contour", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });
    await editor.clickAt({ x: 300, y: 300 });

    await editor.dragFrom({ x: 100, y: 100 }, { x: 100, y: 160 });

    const [contour] = await editor.outline();
    expect(contour?.closed).toBe(true);
    expect(contour?.points.filter(({ pointType }) => pointType === "onCurve")).toHaveLength(3);
    expect(contour?.points[0]).toMatchObject({ ...onCurve(100, 100), smooth: true });
    expect(contour?.points[1]).toMatchObject(offCurve(100, 160));
    expect(contour?.points.at(-1)).toMatchObject(offCurve(100, 40));
  });

  it("leaves the contour open and the stroke going when Escape cancels the closing drag", async () => {
    await drawStroke();

    editor.holdDragFrom({ x: 100, y: 100 }, { x: 160, y: 130 });
    await editor.pressKey("Escape");
    await editor.releaseAt({ x: 160, y: 130 });

    expect(await editor.outline()).toMatchObject([
      { closed: false, points: [onCurve(100, 100), onCurve(300, 100), onCurve(300, 300)] },
    ]);

    await editor.clickAt({ x: 500, y: 500 });
    expect(await editor.outline()).toMatchObject([
      {
        closed: false,
        points: [onCurve(100, 100), onCurve(300, 100), onCurve(300, 300), onCurve(500, 500)],
      },
    ]);
  });
});

describe("joining another open contour", () => {
  beforeEach(async () => {
    await editor.draw({ contours: [line([100, 100], [300, 100])] });
    await editor.clickAt({ x: 100, y: 300 });
    await editor.clickAt({ x: 300, y: 300 });
  });

  it("joins the two contours on a click on the other's end, and ends the stroke", async () => {
    await editor.clickAt({ x: 300, y: 100 });

    expect(await editor.outline()).toMatchObject([
      {
        closed: false,
        points: [onCurve(100, 300), onCurve(300, 300), onCurve(300, 100), onCurve(100, 100)],
      },
    ]);

    await editor.clickAt({ x: 500, y: 500 });
    expect(await editor.outline()).toHaveLength(2);
  });

  it("shows the end cursor over the other contour's end", () => {
    editor.movePointerTo({ x: 100, y: 100 });

    expect(editor.shownCursor()).toBe(cursorToCSS({ type: "pen-end" }));
  });

  it("leaves the joined contour open", async () => {
    await editor.clickAt({ x: 100, y: 100 });

    expect((await editor.outline()).map(({ closed }) => closed)).toEqual([false]);
  });
});
