import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { expectEdit } from "@/testing/expectEdit";
import type { EditorTestSurface } from "@/testing/surface";
import { useTestEditor } from "@/testing/fontFixture";

const ROOT_3 = Math.sqrt(3);

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** An L of two lines, 100,100 → 300,100 → 300,300, with either line optionally a curve. */
function corner(options: { closed?: boolean; curve?: "first" | "second" } = {}) {
  const firstHandles = options.curve === "first" ? HANDLES_ALONG_FIRST : [];
  const secondHandles = options.curve === "second" ? HANDLES_ALONG_SECOND : [];
  return editor.draw({
    contours: [
      {
        closed: options.closed,
        points: [
          { x: 100, y: 100, name: "first" },
          ...firstHandles,
          { x: 300, y: 100, name: "middle" },
          ...secondHandles,
          { x: 300, y: 300, name: "last" },
        ],
      },
    ],
  });
}

const HANDLES_ALONG_FIRST = [
  { x: 167, y: 100, off: true },
  { x: 233, y: 100, off: true },
] as const;
const HANDLES_ALONG_SECOND = [
  { x: 300, y: 167, off: true },
  { x: 300, y: 233, off: true },
] as const;

async function position(id: PointId, from: EditorTestSurface = editor): Promise<Point2D> {
  return (await from.pointPositions([id]))[id]!;
}

async function expectNear(
  id: PointId,
  expected: Point2D,
  from: EditorTestSurface = editor,
): Promise<void> {
  const actual = await position(id, from);
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
}

describe("Shift-dragging an on-curve point snaps its angle", () => {
  it("snaps the first line endpoint around its next point", async () => {
    const { first, middle } = await corner();

    await editor.dragFrom({ x: 100, y: 100 }, { x: 220, y: 160 }, { shiftKey: true });

    await expectNear(first, { x: 300 - 50 * ROOT_3, y: 150 });
    expect(await position(middle)).toEqual({ x: 300, y: 100 });
  });

  it("snaps an open contour's last line endpoint around its previous point", async () => {
    const { middle, last } = await corner();

    await editor.dragFrom({ x: 300, y: 300 }, { x: 360, y: 180 }, { shiftKey: true });

    await expectNear(last, { x: 350, y: 100 + 50 * ROOT_3 });
    expect(await position(middle)).toEqual({ x: 300, y: 100 });
  });

  it("snaps a two-line junction around itself", async () => {
    const { first, middle, last } = await corner();

    await editor.dragFrom({ x: 300, y: 100 }, { x: 330, y: 140 }, { shiftKey: true });

    await expectNear(middle, { x: 325, y: 100 + 25 * ROOT_3 });
    expect(await position(first)).toEqual({ x: 100, y: 100 });
    expect(await position(last)).toEqual({ x: 300, y: 300 });
  });

  it("recognises both lines at a closed contour's first point", async () => {
    const { first } = await corner({ closed: true });

    await editor.dragFrom({ x: 100, y: 100 }, { x: 130, y: 140 }, { shiftKey: true });

    await expectNear(first, { x: 125, y: 100 + 25 * ROOT_3 });
  });

  it("pivots on the next line point when a curve enters the dragged point", async () => {
    const { middle, last } = await corner({ curve: "first" });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 240, y: 220 }, { shiftKey: true });

    await expectNear(middle, { x: 250, y: 300 - 50 * ROOT_3 });
    expect(await position(last)).toEqual({ x: 300, y: 300 });
  });

  it("pivots on itself when an incoming line is followed by a curve", async () => {
    const { middle } = await corner({ curve: "second" });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 330, y: 140 }, { shiftKey: true });

    await expectNear(middle, { x: 325, y: 100 + 25 * ROOT_3 });
  });

  it("pivots on itself at the last point of an open curve", async () => {
    const { last } = await corner({ curve: "second" });

    await editor.dragFrom({ x: 300, y: 300 }, { x: 330, y: 340 }, { shiftKey: true });

    await expectNear(last, { x: 325, y: 300 + 25 * ROOT_3 });
  });

  it("leaves movement free without Shift", async () => {
    const { first } = await corner();

    await editor.dragFrom({ x: 100, y: 100 }, { x: 220, y: 160 });

    expect(await position(first)).toEqual({ x: 220, y: 160 });
  });

  it("does not snap a selection of several points", async () => {
    const { first, last } = await corner();
    editor.select([first, last]);

    await editor.dragFrom({ x: 200, y: 200 }, { x: 230, y: 240 }, { shiftKey: true });

    expect(await editor.pointPositions([first, last])).toEqual({
      [first]: { x: 130, y: 140 },
      [last]: { x: 330, y: 340 },
    });
  });

  it.each([
    {
      down: { x: 100, y: 100 },
      to: { x: 130, y: 140 },
      first: { x: 130, y: 130 },
      last: { x: 300, y: 300 },
    },
    {
      down: { x: 300, y: 300 },
      to: { x: 330, y: 340 },
      first: { x: 100, y: 100 },
      last: { x: 340, y: 340 },
    },
    {
      down: { x: 100, y: 300 },
      to: { x: 70, y: 340 },
      first: { x: 60, y: 100 },
      last: { x: 300, y: 340 },
    },
    {
      down: { x: 300, y: 100 },
      to: { x: 330, y: 60 },
      first: { x: 100, y: 60 },
      last: { x: 340, y: 300 },
    },
  ])(
    "resizes from selection corner $down instead of snapping a point",
    async ({ down, to, first: firstAfter, last: lastAfter }) => {
      const { first, last } = await corner();
      editor.select([first, last]);

      editor.pressAt(down);
      editor.movePointerTo(to, { shiftKey: true });
      expect(editor.toolState()?.state).toBe("resizing");
      await editor.releaseAt(to);

      expect(await editor.pointPositions([first, last])).toEqual({
        [first]: firstAfter,
        [last]: lastAfter,
      });
    },
  );

  it("commits a snapped move as one edit", async () => {
    const { first } = await corner();

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 100, y: 100 }, { x: 220, y: 160 }, { shiftKey: true }),
      (e) => expectNear(first, { x: 300 - 50 * ROOT_3, y: 150 }, e),
    );
  });
});
