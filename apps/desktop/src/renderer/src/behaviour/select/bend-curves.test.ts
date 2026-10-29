import { beforeEach, describe, expect, it } from "vitest";
import { Curve, Vec2 } from "@shift/geo";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import { cubic, line, triangle } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** A straight curve from 100,200 to 200,200, its handles at the thirds. */
const FLAT_CURVE = {
  contours: [
    cubic(
      { x: 100, y: 200, name: "start" },
      { x: 100 + 100 / 3, y: 200, name: "one" },
      { x: 100 + 200 / 3, y: 200, name: "two" },
      { x: 200, y: 200, name: "end" },
    ),
  ],
};

/** A straight curve from 100,100 to 300,300, its handles at the thirds. */
const DIAGONAL_CURVE = {
  contours: [
    cubic(
      { x: 100, y: 100, name: "start" },
      { x: 100 + 200 / 3, y: 100 + 200 / 3, name: "one" },
      { x: 100 + 400 / 3, y: 100 + 400 / 3, name: "two" },
      { x: 300, y: 300, name: "end" },
    ),
  ],
};

/** A straight curve from 100,200 to 190,230, its handles at the thirds. */
const SLOPED_CURVE = {
  contours: [
    cubic(
      { x: 100, y: 200, name: "start" },
      { x: 130, y: 210, name: "one" },
      { x: 160, y: 220, name: "two" },
      { x: 190, y: 230, name: "end" },
    ),
  ],
};

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
    ({ one, two } = await editor.draw(FLAT_CURVE));
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
    expect(editor.drawnPoint(one)).not.toMatchObject({ x: 100 + 100 / 3, y: 200 });
    await editor.pressKey("Escape");

    expect(editor.toolCursor()).toBe("default");
    expect(await editor.outline()).toEqual(before);
  });

  it("bends as one edit", async () => {
    await expectEdit(
      editor,
      (e) => e.dragFrom(middle, { x: 154, y: 240 }),
      async (e) => {
        expect(await e.point(one)).toMatchObject({ y: expect.toSatisfy((y: number) => y > 200) });
        expect(await e.point(two)).toMatchObject({ y: expect.toSatisfy((y: number) => y > 200) });
      },
    );
  });

  it("snaps each handle to the nearest 45° while Shift bends a flat curve", async () => {
    await editor.dragFrom(middle, { x: 150, y: 240 }, { shiftKey: true });

    const handleOne = Vec2.sub((await editor.point(one))!, { x: 100, y: 200 });
    const handleTwo = Vec2.sub((await editor.point(two))!, { x: 200, y: 200 });
    expect(handleOne.x).toBeGreaterThan(0);
    expect(handleOne.y).toBeCloseTo(handleOne.x);
    expect(handleTwo.x).toBeLessThan(0);
    expect(handleTwo.y).toBeCloseTo(-handleTwo.x);
    const [p0, p1, p2, p3] = (await editor.outline())[0]!.points;
    expect(Curve.pointAt(Curve.cubic(p0!, p1!, p2!, p3!), 0.5).y).toBeCloseTo(240);
  });

  it("frees the handles once Shift is released mid-bend", () => {
    editor.pressAt(middle);
    editor.movePointerTo({ x: 154, y: 200 });
    editor.movePointerTo({ x: 150, y: 240 }, { shiftKey: true });
    const [, snappedOne] = editor.drawnOutline()[0]!.points;
    const snapped = Vec2.sub(snappedOne!, { x: 100, y: 200 });
    expect(snapped.y).toBeCloseTo(snapped.x);

    editor.movePointerTo({ x: 150, y: 241 });
    const [, freeOne] = editor.drawnOutline()[0]!.points;
    const free = Vec2.sub(freeOne!, { x: 100, y: 200 });
    expect(free.y).not.toBeCloseTo(free.x);
  });

  it("keeps each handle's direction and changes only its length while Alt is held", async () => {
    await editor.dragFrom(middle, { x: 170, y: 240 });
    const oneBefore = Vec2.sub((await editor.point(one))!, { x: 100, y: 200 });
    const twoBefore = Vec2.sub((await editor.point(two))!, { x: 200, y: 200 });
    const [p0, p1, p2, p3] = (await editor.outline())[0]!.points;
    const bent = Curve.pointAt(Curve.cubic(p0!, p1!, p2!, p3!), 0.5);

    await editor.dragFrom(bent, { x: bent.x - 10, y: bent.y + 30 }, { altKey: true });

    const oneAfter = Vec2.sub((await editor.point(one))!, { x: 100, y: 200 });
    const twoAfter = Vec2.sub((await editor.point(two))!, { x: 200, y: 200 });
    expect(Vec2.cross(Vec2.unit(oneAfter), Vec2.unit(oneBefore))).toBeCloseTo(0);
    expect(Vec2.cross(Vec2.unit(twoAfter), Vec2.unit(twoBefore))).toBeCloseTo(0);
    expect(Vec2.dot(oneAfter, oneBefore)).toBeGreaterThan(0);
    expect(Vec2.dot(twoAfter, twoBefore)).toBeGreaterThan(0);
    expect(Vec2.len(oneAfter)).not.toBeCloseTo(Vec2.len(oneBefore), 0);
  });
});

describe("Shift-bending a diagonal curve", () => {
  it("snaps its handles to one horizontal and one vertical", async () => {
    const { one, two } = await editor.draw(DIAGONAL_CURVE);

    await editor.dragFrom({ x: 200, y: 200 }, { x: 260, y: 140 }, { shiftKey: true });

    expect(await editor.point(one)).toMatchObject({ x: 260, y: 100 });
    expect(await editor.point(two)).toMatchObject({ x: 300, y: 140 });
  });
});

describe("dragging an unselected curve", () => {
  it("bends it without moving its ends", async () => {
    const { start, one, two, end } = await editor.draw(SLOPED_CURVE);

    await editor.dragFrom({ x: 145, y: 215 }, { x: 149, y: 255 });

    expect(await editor.point(one)).toMatchObject({ y: expect.toSatisfy((y: number) => y > 210) });
    expect(await editor.point(two)).toMatchObject({ y: expect.toSatisfy((y: number) => y > 220) });
    expect(await editor.point(start)).toMatchObject({ x: 100, y: 200 });
    expect(await editor.point(end)).toMatchObject({ x: 190, y: 230 });
  });

  it("moves it whole once it is selected by a click", async () => {
    const { start, one, two, end } = await editor.draw(SLOPED_CURVE);
    await editor.clickAt({ x: 145, y: 215 });

    await editor.dragFrom({ x: 145, y: 215 }, { x: 149, y: 255 });

    expect(await editor.point(start)).toMatchObject({ x: 104, y: 240 });
    expect(await editor.point(one)).toMatchObject({ x: 134, y: 250 });
    expect(await editor.point(two)).toMatchObject({ x: 164, y: 260 });
    expect(await editor.point(end)).toMatchObject({ x: 194, y: 270 });
  });
});
