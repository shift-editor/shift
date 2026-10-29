import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { PointId } from "@shift/types";
import type { GlyphFixture } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** An open zigzag, 100,120 → 240,260 → 380,160. */
const ZIGZAG = {
  contours: [
    {
      points: [
        { x: 100, y: 120, name: "left" },
        { x: 240, y: 260, name: "middle" },
        { x: 380, y: 160, name: "right" },
      ],
    },
  ],
} as const satisfies GlyphFixture;

describe("dragging points aligns them with points that stay put", () => {
  it("lines a point up vertically with another point's x", async () => {
    const { middle } = await editor.draw(ZIGZAG);
    const nearX = 100 + editor.hitDistance() / 2;

    await expectEdit(editor, (e) => e.dragFrom({ x: 240, y: 260 }, { x: nearX, y: 300 }), {
      [middle]: { x: 100, y: 300 },
    });
  });

  it("aligns each axis with a different point in one drag", async () => {
    const { left, middle, right } = await editor.draw(ZIGZAG);
    const near = editor.hitDistance() / 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: 380 - near, y: 120 + near });

    expect(await editor.point(left)).toMatchObject({ x: 100, y: 120 });
    expect(await editor.point(middle)).toMatchObject({ x: 380, y: 120 });
    expect(await editor.point(right)).toMatchObject({ x: 380, y: 160 });
  });

  it("does not align beyond the hit distance", async () => {
    const { middle } = await editor.draw(ZIGZAG);
    const farX = 100 + editor.hitDistance() * 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: farX, y: 300 });

    expect(await editor.point(middle)).toMatchObject({ x: farX, y: 300 });
  });

  it("lets a rectangle's top edge shift sideways off its own bottom corners", async () => {
    const { topLeft, topRight } = await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            [100, 100],
            { x: 100, y: 300, name: "topLeft" },
            { x: 300, y: 300, name: "topRight" },
            [300, 100],
          ],
        },
      ],
    });
    const shift = editor.hitDistance() / 2;

    await editor.dragFrom({ x: 200, y: 300 }, { x: 200 + shift, y: 260 });

    expect(await editor.point(topLeft)).toMatchObject({ x: 100 + shift, y: 260 });
    expect(await editor.point(topRight)).toMatchObject({ x: 300 + shift, y: 260 });
  });
});

describe("dragging points aligns only with points on screen", () => {
  // A contour whose last point, at 180,6000, is scrolled out of view.
  let middle: PointId;
  beforeEach(async () => {
    editor.resizeCanvas(1000, 800);
    const names = await editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 120, name: "left" },
            { x: 240, y: 260, name: "middle" },
            [180, 6000],
          ],
        },
      ],
    });
    ({ middle } = names);
    editor.select([names.left, names.middle]);
    editor.zoomToSelection();
    editor.select([]);
  });

  it("ignores a point scrolled out of view", async () => {
    const nearOffscreenX = 180 + editor.hitDistance() / 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: nearOffscreenX, y: 200 });

    expect(await editor.point(middle)).toBeNear({ x: nearOffscreenX, y: 200 });
  });

  it("still aligns with a point in view", async () => {
    const nearLeftX = 100 + editor.hitDistance() / 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: nearLeftX, y: 200 });

    expect(await editor.point(middle)).toMatchObject({ x: 100, y: expect.closeTo(200) });
  });
});
