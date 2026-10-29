import { beforeEach, describe, expect, it } from "vitest";
import { line, square, type GlyphFixture } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

/** How far diagonally outside a selection corner the user presses to rotate, in screen pixels. */
const ROTATE_GRAB_OFFSET_PX = 8;

/** A 100-unit square with an opposite-winding 50-unit hole in the middle. */
const SQUARE_WITH_HOLE: GlyphFixture = {
  contours: [
    square(100),
    {
      closed: true,
      points: [
        [25, 25],
        [25, 75],
        [75, 75],
        [75, 25],
      ],
    },
  ],
};

// The glyphs the tests place as components in A, which is open.
const editor = useTestEditor({
  glyphs: {
    base: { outline: { contours: [square(100)] } },
    leaf: { outline: { contours: [square(100)] } },
    middle: { outline: { components: [{ glyph: "leaf" }] } },
    counter: { outline: SQUARE_WITH_HOLE },
    open: { outline: { contours: [line([0, 0], [100, 0])] } },
    curve: {
      outline: {
        contours: [
          {
            closed: true,
            points: [[0, 0], { x: 50, y: 100, off: true }, [100, 0], [100, -10], [0, -10]],
          },
        ],
      },
    },
  },
});
beforeEach(() => {
  editor.selectTool("select");
});

describe("clicking a component's fill selects the component", () => {
  it("selects the frontmost of two overlapping components", async () => {
    await editor.draw({ components: [{ glyph: "base" }, { glyph: "base" }] });
    const [, front] = await editor.components();

    await editor.clickAt({ x: 50, y: 50 });

    expect(editor.selectionIds()).toEqual([front?.id]);
  });

  it("selects the component placed in this glyph, not one nested inside it", async () => {
    await editor.draw({ components: [{ glyph: "middle" }] });
    const [direct] = await editor.components();

    await editor.clickAt({ x: 50, y: 50 });

    expect(editor.selectionIds()).toEqual([direct?.id]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(editor.boundingBoxShown()).toBe(true);
  });

  it("does not select through an opposite-winding hole", async () => {
    await editor.draw({ components: [{ glyph: "counter" }] });
    const [component] = await editor.components();

    await editor.clickAt({ x: 10, y: 10 });
    expect(editor.selectionIds()).toEqual([component?.id]);

    await editor.clickAt({ x: 50, y: 50 });
    expect(editor.selectionIds()).toEqual([]);
  });

  it("selects an open component by nearness to its line", async () => {
    await editor.draw({ components: [{ glyph: "open" }] });
    const [component] = await editor.components();

    await editor.clickAt({ x: 50, y: 0 });

    expect(editor.selectionIds()).toEqual([component?.id]);
  });

  it("follows the component's curves", async () => {
    await editor.draw({ components: [{ glyph: "curve" }] });
    const [component] = await editor.components();

    await editor.clickAt({ x: 50, y: 25 });
    expect(editor.selectionIds()).toEqual([component?.id]);

    await editor.clickAt({ x: 50, y: 75 });
    expect(editor.selectionIds()).toEqual([]);
  });
});

describe("dragging a selected component transforms it", () => {
  beforeEach(async () => {
    await editor.draw({ components: [{ glyph: "counter" }] });
    await editor.clickAt({ x: 10, y: 10 });
  });

  it("moves it from empty space inside its bounds, as one edit", async () => {
    await editor.dragFrom({ x: 50, y: 50 }, { x: 80, y: 70 });

    expect(await editor.components()).toMatchObject([{ transformation: { dx: 30, dy: 20 } }]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: 30, y: 20, width: 100, height: 100 });

    await editor.undo();
    expect(await editor.components()).toMatchObject([{ transformation: { dx: 0, dy: 0 } }]);
    await editor.redo();
    expect(await editor.components()).toMatchObject([{ transformation: { dx: 30, dy: 20 } }]);
  });

  it("leaves it in place when Escape cancels the move", async () => {
    editor.pressAt({ x: 50, y: 50 });
    editor.movePointerTo({ x: 54, y: 52 });
    editor.movePointerTo({ x: 80, y: 70 });
    await editor.pressKey("Escape");

    expect(await editor.components()).toMatchObject([{ transformation: { dx: 0, dy: 0 } }]);
  });

  it("scales it from a corner handle", async () => {
    await editor.dragFrom({ x: 100, y: 100 }, { x: 150, y: 150 });

    expect(await editor.components()).toMatchObject([{ transformation: { xx: 1.5, yy: 1.5 } }]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: 0, y: 0, width: 150, height: 150 });
  });

  it("rotates it from just outside a corner", async () => {
    const offset = ROTATE_GRAB_OFFSET_PX * editor.pixelSize();
    const centre = { x: 50, y: 50 };
    const down = { x: 100 + offset, y: 100 + offset };
    const quarterTurn = { x: centre.x - (down.y - centre.y), y: centre.y + (down.x - centre.x) };

    await editor.dragFrom(down, quarterTurn);

    expect(await editor.components()).toMatchObject([
      { transformation: { xx: expect.closeTo(0), xy: expect.closeTo(1) } },
    ]);
  });
});
