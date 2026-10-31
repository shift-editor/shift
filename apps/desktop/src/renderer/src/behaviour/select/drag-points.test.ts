import { describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("dragging a selected point moves the selection", () => {
  it("moves every selected point by the drag", async () => {
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

    await expectEdit(
      editor,
      async (e) => {
        e.selectTool("select");
        e.select([a, b, c]);
        await e.dragPoint(b, { x: 36, y: 30 });
      },
      {
        [a]: { x: 136, y: 130 },
        [b]: { x: 186, y: 180 },
        [c]: { x: 236, y: 230 },
      },
    );
  });

  it("leaves points it did not select where they were", async () => {
    const { a, b } = await editor.draw({
      contours: [line({ x: 100, y: 100, name: "a" }, { x: 150, y: 150, name: "b" })],
    });

    await expectEdit(
      editor,
      async (e) => {
        e.selectTool("select");
        e.select([b]);
        await e.dragPoint(b, { x: 20, y: 0 });
      },
      { [a]: { x: 100, y: 100 }, [b]: { x: 170, y: 150 } },
    );
  });

  it("puts the points back when the drag is abandoned", async () => {
    const { a } = await editor.draw({
      contours: [line({ x: 100, y: 100, name: "a" }, [150, 150])],
    });
    const before = await editor.outline();
    editor.selectTool("select");
    editor.select([a]);

    editor.holdDrag(a, { x: 40, y: 40 });
    editor.cancelGesture();
    await editor.settle();

    expect(await editor.outline()).toEqual(before);
  });
});
