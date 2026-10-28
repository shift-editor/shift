import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

describe("dragging points aligns them with points that stay put", () => {
  async function drawZigzag() {
    return editor.draw({
      contours: [
        {
          points: [
            { x: 100, y: 120, name: "left" },
            { x: 240, y: 260, name: "middle" },
            { x: 380, y: 160, name: "right" },
          ],
        },
      ],
    });
  }

  it("lines a point up vertically with another point's x", async () => {
    const { middle } = await drawZigzag();
    const nearX = 100 + editor.hitDistance() / 2;

    await expectEdit(editor, (e) => e.dragFrom({ x: 240, y: 260 }, { x: nearX, y: 300 }), {
      [middle]: { x: 100, y: 300 },
    });
  });

  it("aligns each axis with a different point in one drag", async () => {
    const { left, middle, right } = await drawZigzag();
    const near = editor.hitDistance() / 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: 380 - near, y: 120 + near });

    expect(await editor.pointPositions([left, middle, right])).toEqual({
      [left]: { x: 100, y: 120 },
      [middle]: { x: 380, y: 120 },
      [right]: { x: 380, y: 160 },
    });
  });

  it("does not align beyond the hit distance", async () => {
    const { middle } = await drawZigzag();
    const farX = 100 + editor.hitDistance() * 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: farX, y: 300 });

    expect(await editor.pointPositions([middle])).toEqual({ [middle]: { x: farX, y: 300 } });
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

    expect(await editor.pointPositions([topLeft, topRight])).toEqual({
      [topLeft]: { x: 100 + shift, y: 260 },
      [topRight]: { x: 300 + shift, y: 260 },
    });
  });
});

describe("dragging points aligns only with points on screen", () => {
  async function drawTallContour() {
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
    editor.select([names.left, names.middle]);
    editor.zoomToSelection();
    editor.select([]);
    return names;
  }

  it("ignores a point scrolled out of view", async () => {
    const { middle } = await drawTallContour();
    const nearOffscreenX = 180 + editor.hitDistance() / 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: nearOffscreenX, y: 200 });

    const moved = (await editor.pointPositions([middle]))[middle]!;
    expect(moved.x).toBeCloseTo(nearOffscreenX);
    expect(moved.y).toBeCloseTo(200);
  });

  it("still aligns with a point in view", async () => {
    const { middle } = await drawTallContour();
    const nearLeftX = 100 + editor.hitDistance() / 2;

    await editor.dragFrom({ x: 240, y: 260 }, { x: nearLeftX, y: 200 });

    const moved = (await editor.pointPositions([middle]))[middle]!;
    expect(moved.x).toBe(100);
    expect(moved.y).toBeCloseTo(200);
  });
});
