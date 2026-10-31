import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
let xHeight: number;
let top: number;
let topLeft: PointId;
let topRight: PointId;

beforeEach(async () => {
  const authored = editor.metrics().xHeight;
  if (authored === undefined) throw new Error("Expected the test font to author an x-height");
  xHeight = authored;
  top = xHeight - 40;
  ({ topLeft, topRight } = await editor.draw({
    contours: [
      {
        points: [
          [300, 0],
          { x: 300, y: top, name: "topLeft" },
          { x: 500, y: top, name: "topRight" },
          [500, 0],
        ],
      },
    ],
  }));
  editor.selectTool("select");
});

describe("dragging points snaps them to the font's metrics", () => {
  it("snaps a lone point to a metric within the hit distance", async () => {
    const near = xHeight - editor.hitDistance() / 2;

    await expectEdit(editor, (e) => e.dragFrom({ x: 300, y: top }, { x: 340, y: near }), {
      [topLeft]: { x: 340, y: xHeight },
      [topRight]: { x: 500, y: top },
    });
  });

  it("leaves a point free beyond the hit distance", async () => {
    const far = xHeight - editor.hitDistance() * 2;

    await editor.dragFrom({ x: 300, y: top }, { x: 340, y: far });

    expect(await editor.point(topLeft)).toMatchObject({ x: 340, y: far });
  });

  it("lands both corners of a dragged edge on the metric", async () => {
    const lift = 40 - editor.hitDistance() / 2;

    await editor.dragFrom({ x: 400, y: top }, { x: 400, y: top + lift });

    expect(await editor.point(topLeft)).toMatchObject({ x: 300, y: xHeight });
    expect(await editor.point(topRight)).toMatchObject({ x: 500, y: xHeight });
  });

  it("suspends snapping while Cmd is held", async () => {
    const near = xHeight - editor.hitDistance() / 2;

    await editor.dragFrom({ x: 300, y: top }, { x: 340, y: near }, { metaKey: true });

    expect(await editor.point(topLeft)).toMatchObject({ x: 340, y: near });
  });

  it("snaps again once Cmd is released mid-drag", async () => {
    const near = xHeight - editor.hitDistance() / 2;
    const target = { x: 340, y: near };

    editor.pressAt({ x: 300, y: top }, { metaKey: true });
    editor.movePointerTo({ x: 320, y: top + 10 }, { metaKey: true });
    editor.movePointerTo(target, { metaKey: true });
    editor.movePointerTo(target);
    await editor.releaseAt(target);

    expect(await editor.point(topLeft)).toMatchObject({ x: 340, y: xHeight });
  });
});
