import { describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { cubic, line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("adding a point on a segment with the Pen", () => {
  it("splits a line with one corner where it is clicked, as one undo step", async () => {
    await editor.draw({
      contours: [line([0, 0], [100, 0])],
    });
    editor.selectTool("pen");

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 50, y: 0 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([{ points: Array(3).fill({}) }]);
        expect(await e.pointAt({ x: 50, y: 0 })).toMatchObject({ pointType: "onCurve" });
      },
    );
  });

  it("splits a line at the clicked fraction of its length", async () => {
    await editor.draw({
      contours: [line([0, 0], [100, 100])],
    });
    editor.selectTool("pen");

    await editor.clickAt({ x: 25, y: 25 });

    expect(await editor.pointAt({ x: 25, y: 25 })).toMatchObject({ pointType: "onCurve" });
  });

  it("splits a cubic into two with a smooth point between, as one undo step", async () => {
    await editor.draw({
      contours: [cubic([0, 0], [25, 100], [75, 100], [100, 0])],
    });
    editor.selectTool("pen");

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 50, y: 75 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            points: [
              { pointType: "onCurve" },
              { pointType: "offCurve" },
              { pointType: "offCurve" },
              { pointType: "onCurve", smooth: true },
              { pointType: "offCurve" },
              { pointType: "offCurve" },
              { pointType: "onCurve" },
            ],
          },
        ]);
      },
    );
  });

  it("splits a quadratic into two quadratics, as one undo step", async () => {
    await editor.draw({
      contours: [
        { points: [[0, 0], { x: 50, y: 100, off: true }, { x: 100, y: 0, qCurve: true }] },
      ],
    });
    expect(await editor.outline()).toMatchObject([
      { points: [{ pointType: "onCurve" }, { pointType: "offCurve" }, { pointType: "qCurve" }] },
    ]);
    editor.selectTool("pen");

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 50, y: 50 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            points: [
              { pointType: "onCurve" },
              { pointType: "offCurve" },
              { pointType: "qCurve" },
              { pointType: "offCurve" },
              { pointType: "qCurve" },
            ],
          },
        ]);
      },
    );
  });
});
