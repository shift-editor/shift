import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** An open L, 100,100 → 300,100 → 300,300. */
function openCorner() {
  return editor.draw({
    contours: [{ points: [[100, 100], [300, 100], { x: 300, y: 300, name: "end" }] }],
  });
}

describe("dropping an open end onto another open end joins them", () => {
  it("closes the contour when its end lands on its own start, as one edit", async () => {
    await openCorner();

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 300, y: 300 }, { x: 101, y: 101 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            closed: true,
            points: [
              { x: 100, y: 100 },
              { x: 300, y: 100 },
            ],
          },
        ]);
      },
    );
  });

  it("keeps an on-curve start when a curve's first point is dropped on its end", async () => {
    await editor.draw({
      contours: [
        {
          points: [
            [100, 100],
            { x: 200, y: 100, off: true },
            { x: 220, y: 20, off: true },
            { x: 300, y: 100, smooth: true },
            { x: 380, y: 180, off: true },
            { x: 350, y: 220, off: true },
            [300, 300],
          ],
        },
      ],
    });

    await editor.dragFrom({ x: 100, y: 100 }, { x: 299, y: 299 });

    const [contour] = await editor.outline();
    expect(contour?.closed).toBe(true);
    expect(contour?.points[0]).toMatchObject({ x: 300, y: 300, pointType: "onCurve" });
  });

  it("joins two contours when an end lands on the other's end", async () => {
    await editor.draw({
      contours: [line([100, 100], [300, 100]), line([100, 300], [300, 300])],
    });

    await editor.dragFrom({ x: 300, y: 300 }, { x: 299, y: 101 });

    expect(await editor.outline()).toMatchObject([
      {
        closed: false,
        points: [
          { x: 100, y: 300 },
          { x: 300, y: 100 },
          { x: 100, y: 100 },
        ],
      },
    ]);
  });

  it("shows the end cursor while a dragged end is over another open end", async () => {
    await openCorner();

    editor.pressAt({ x: 300, y: 300 });
    editor.movePointerTo({ x: 280, y: 280 });
    expect(editor.toolCursor()).toBe("move");

    editor.movePointerTo({ x: 101, y: 101 });
    expect(editor.toolCursor()).toBe("end");
    await editor.pressKey("Escape");
  });

  it("only moves an end dropped away from other ends", async () => {
    const { end } = await openCorner();

    await editor.dragFrom({ x: 300, y: 300 }, { x: 300, y: 250 });

    const [contour] = await editor.outline();
    expect(contour?.closed).toBe(false);
    expect(contour?.points).toHaveLength(3);
    expect(await editor.pointPositions([end])).toEqual({ [end]: { x: 300, y: 250 } });
  });
});
