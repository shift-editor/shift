import { beforeEach, describe, expect, it } from "vitest";
import { Vec2, type Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { cubic, line, triangle } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

const third = (from: number, to: number, step: 1 | 2) => from + ((to - from) * step) / 3;

/** A straight curve from `start` to `end`, its handles at the thirds. */
function flatCurve(start: Point2D, end: Point2D) {
  return editor.draw({
    contours: [
      cubic(
        { ...start, name: "start" },
        { x: third(start.x, end.x, 1), y: third(start.y, end.y, 1), name: "one" },
        { x: third(start.x, end.x, 2), y: third(start.y, end.y, 2), name: "two" },
        { ...end, name: "end" },
      ),
    ],
  });
}

/** The point halfway along the open glyph's first curve. */
async function curveMidpoint(): Promise<Point2D> {
  const [p0, p1, p2, p3] = (await editor.outline())[0]!.points;
  return {
    x: (p0!.x + 3 * p1!.x + 3 * p2!.x + p3!.x) / 8,
    y: (p0!.y + 3 * p1!.y + 3 * p2!.y + p3!.y) / 8,
  };
}

async function position(id: PointId): Promise<Point2D> {
  return (await editor.pointPositions([id]))[id]!;
}

describe("Cmd-clicking a line turns it into a curve", () => {
  it("puts the handles at the thirds, as one edit", async () => {
    await editor.draw({
      contours: [line([100, 200], [190, 230])],
    });

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 130, y: 210 }, { metaKey: true }),
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            points: [
              { x: 100, y: 200, pointType: "onCurve" },
              { x: 130, y: 210, pointType: "offCurve" },
              { x: 160, y: 220, pointType: "offCurve" },
              { x: 190, y: 230, pointType: "onCurve" },
            ],
          },
        ]);
      },
    );
  });

  it("keeps the contour's on-curve start when the closing line is curved", async () => {
    await editor.draw({
      contours: [triangle([100, 100], [400, 100], [400, 400])],
    });
    const [before] = await editor.outline();

    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 250, y: 250 }, { metaKey: true }),
      async (e) => {
        expect(await e.outline()).toEqual([
          {
            ...before,
            points: [
              ...before!.points,
              expect.objectContaining({ x: 300, y: 300, pointType: "offCurve" }),
              expect.objectContaining({ x: 200, y: 200, pointType: "offCurve" }),
            ],
          },
        ]);
      },
    );
  });

  it("does not curve a line on Alt-click", async () => {
    await editor.draw({
      contours: [line([100, 200], [190, 230])],
    });
    const before = await editor.outline();

    await editor.clickAt({ x: 145, y: 215 }, { altKey: true });

    expect(await editor.outline()).toEqual(before);
  });

  it("offers the bend cursor while Cmd is held over a line, without changing it", async () => {
    await editor.draw({
      contours: [line([100, 200], [190, 230])],
    });
    const before = await editor.outline();

    editor.movePointerTo({ x: 145, y: 215 });
    await editor.pressKey("Meta", { metaKey: true });
    expect(editor.toolCursor()).toBe("bend");
    expect(await editor.outline()).toEqual(before);

    editor.movePointerTo({ x: 145, y: 215 });
    expect(editor.toolCursor()).toBe("default");
  });

  it("offers moving over a line inside the selection, and bending with Cmd", async () => {
    const { first, second } = await editor.draw(
      {
        contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })],
      },
      { select: true },
    );
    const before = await editor.outline();

    editor.movePointerTo({ x: 150, y: 150 });
    expect(editor.toolCursor()).toBe("move");

    editor.movePointerTo({ x: 150, y: 150 }, { metaKey: true });
    expect(editor.toolCursor()).toBe("bend");
    expect(await editor.outline()).toEqual(before);
    expect(editor.selectionIds()).toEqual([first, second]);
  });
});

describe("dragging a curve bends it", () => {
  let one: PointId;
  let two: PointId;
  const middle = { x: 150, y: 200 };

  beforeEach(async () => {
    ({ one, two } = await flatCurve({ x: 100, y: 200 }, { x: 200, y: 200 }));
  });

  it("keeps the normal cursor over a curve with Cmd or Alt held", async () => {
    editor.movePointerTo(middle);
    expect(editor.toolCursor()).toBe("default");
    await editor.pressKey("Meta");
    expect(editor.toolCursor()).toBe("default");
    await editor.pressKey("Alt", { altKey: true });
    expect(editor.toolCursor()).toBe("default");
  });

  it("does not offer bending over a point or empty canvas", () => {
    editor.movePointerTo({ x: 100, y: 200 });
    expect(editor.toolCursor()).toBe("default");
    editor.movePointerTo({ x: 400, y: 500 });
    expect(editor.toolCursor()).toBe("default");
  });

  it("shows the bend cursor for the whole bend", async () => {
    editor.pressAt(middle);
    editor.movePointerTo({ x: 154, y: 200 });
    expect(editor.toolCursor()).toBe("bend");
    editor.movePointerTo({ x: 154, y: 240 });
    expect(editor.toolCursor()).toBe("bend");
    await editor.releaseAt({ x: 154, y: 240 });

    expect(editor.toolCursor()).toBe("default");
  });

  it("puts both handles back when Escape cancels the bend", async () => {
    const before = await editor.outline();

    editor.pressAt(middle);
    editor.movePointerTo({ x: 154, y: 200 });
    editor.movePointerTo({ x: 154, y: 240 });
    expect(editor.shownPointPositions([one])[one]).not.toEqual({ x: third(100, 200, 1), y: 200 });
    await editor.pressKey("Escape");

    expect(editor.toolCursor()).toBe("default");
    expect(await editor.outline()).toEqual(before);
  });

  it("bends as one edit", async () => {
    await expectEdit(
      editor,
      (e) => e.dragFrom(middle, { x: 154, y: 240 }),
      async (e) => {
        const shown = await e.pointPositions([one, two]);
        expect(shown[one]!.y).toBeGreaterThan(200);
        expect(shown[two]!.y).toBeGreaterThan(200);
      },
    );
  });

  it("snaps each handle to the nearest 45° while Shift bends a flat curve", async () => {
    await editor.dragFrom(middle, { x: 150, y: 240 }, { shiftKey: true });

    const handleOne = Vec2.sub(await position(one), { x: 100, y: 200 });
    const handleTwo = Vec2.sub(await position(two), { x: 200, y: 200 });
    expect(handleOne.x).toBeGreaterThan(0);
    expect(handleOne.y).toBeCloseTo(handleOne.x);
    expect(handleTwo.x).toBeLessThan(0);
    expect(handleTwo.y).toBeCloseTo(-handleTwo.x);
    expect((await curveMidpoint()).y).toBeCloseTo(240);
  });

  it("frees the handles once Shift is released mid-bend", () => {
    const handleOne = () => Vec2.sub(editor.shownPointPositions([one])[one]!, { x: 100, y: 200 });

    editor.pressAt(middle);
    editor.movePointerTo({ x: 154, y: 200 });
    editor.movePointerTo({ x: 150, y: 240 }, { shiftKey: true });
    expect(handleOne().y).toBeCloseTo(handleOne().x);

    editor.movePointerTo({ x: 150, y: 241 });
    expect(handleOne().y).not.toBeCloseTo(handleOne().x);
  });

  it("keeps each handle's direction and changes only its length while Alt is held", async () => {
    await editor.dragFrom(middle, { x: 170, y: 240 });
    const oneBefore = Vec2.sub(await position(one), { x: 100, y: 200 });
    const twoBefore = Vec2.sub(await position(two), { x: 200, y: 200 });
    const bent = await curveMidpoint();

    await editor.dragFrom(bent, { x: bent.x - 10, y: bent.y + 30 }, { altKey: true });

    const oneAfter = Vec2.sub(await position(one), { x: 100, y: 200 });
    const twoAfter = Vec2.sub(await position(two), { x: 200, y: 200 });
    expect(Vec2.cross(Vec2.unit(oneAfter), Vec2.unit(oneBefore))).toBeCloseTo(0);
    expect(Vec2.cross(Vec2.unit(twoAfter), Vec2.unit(twoBefore))).toBeCloseTo(0);
    expect(Vec2.dot(oneAfter, oneBefore)).toBeGreaterThan(0);
    expect(Vec2.dot(twoAfter, twoBefore)).toBeGreaterThan(0);
    expect(Vec2.len(oneAfter)).not.toBeCloseTo(Vec2.len(oneBefore), 0);
  });
});

describe("Shift-bending a diagonal curve", () => {
  it("snaps its handles to one horizontal and one vertical", async () => {
    const { one, two } = await flatCurve({ x: 100, y: 100 }, { x: 300, y: 300 });

    await editor.dragFrom({ x: 200, y: 200 }, { x: 260, y: 140 }, { shiftKey: true });

    expect(await editor.pointPositions([one, two])).toEqual({
      [one]: { x: 260, y: 100 },
      [two]: { x: 300, y: 140 },
    });
  });
});

describe("dragging an unselected curve", () => {
  it("bends it without moving its ends", async () => {
    const { start, one, two, end } = await flatCurve({ x: 100, y: 200 }, { x: 190, y: 230 });

    await editor.dragFrom({ x: 145, y: 215 }, { x: 149, y: 255 });

    const moved = await editor.pointPositions([start, one, two, end]);
    expect(moved[one]!.y).toBeGreaterThan(210);
    expect(moved[two]!.y).toBeGreaterThan(220);
    expect(moved[start]).toEqual({ x: 100, y: 200 });
    expect(moved[end]).toEqual({ x: 190, y: 230 });
  });

  it("moves it whole once it is selected by a click", async () => {
    const { start, one, two, end } = await flatCurve({ x: 100, y: 200 }, { x: 190, y: 230 });
    await editor.clickAt({ x: 145, y: 215 });

    await editor.dragFrom({ x: 145, y: 215 }, { x: 149, y: 255 });

    expect(await editor.pointPositions([start, one, two, end])).toEqual({
      [start]: { x: 104, y: 240 },
      [one]: { x: 134, y: 250 },
      [two]: { x: 164, y: 260 },
      [end]: { x: 194, y: 270 },
    });
  });
});
