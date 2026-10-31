import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { ContourFixture } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const ROOT_3 = Math.sqrt(3);

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

const FIRST = { x: 100, y: 100, name: "first" } as const;
const MIDDLE = { x: 300, y: 100, name: "middle" } as const;
const LAST = { x: 300, y: 300, name: "last" } as const;
const HANDLES_ALONG_FIRST = [
  { x: 167, y: 100, off: true },
  { x: 233, y: 100, off: true },
] as const;
const HANDLES_ALONG_SECOND = [
  { x: 300, y: 167, off: true },
  { x: 300, y: 233, off: true },
] as const;

/** An open L of two lines, 100,100 → 300,100 → 300,300. */
const CORNER = { points: [FIRST, MIDDLE, LAST] } satisfies ContourFixture;
/** {@link CORNER} closed back to its first point. */
const CLOSED_CORNER = { ...CORNER, closed: true } satisfies ContourFixture;
/** {@link CORNER} with its first line a curve. */
const CORNER_CURVING_FIRST = {
  points: [FIRST, ...HANDLES_ALONG_FIRST, MIDDLE, LAST],
} satisfies ContourFixture;
/** {@link CORNER} with its second line a curve. */
const CORNER_CURVING_SECOND = {
  points: [FIRST, MIDDLE, ...HANDLES_ALONG_SECOND, LAST],
} satisfies ContourFixture;

describe("Shift-dragging an on-curve point snaps its angle", () => {
  it("snaps the first line endpoint around its next point", async () => {
    const { first, middle } = await editor.draw({ contours: [CORNER] });

    await editor.dragFrom({ x: 100, y: 100 }, { x: 220, y: 160 }, { shiftKey: true });

    expect(await editor.point(first)).toBeNear({ x: 300 - 50 * ROOT_3, y: 150 });
    expect(await editor.point(middle)).toMatchObject({ x: 300, y: 100 });
  });

  it("snaps an open contour's last line endpoint around its previous point", async () => {
    const { middle, last } = await editor.draw({ contours: [CORNER] });

    await editor.dragFrom({ x: 300, y: 300 }, { x: 360, y: 180 }, { shiftKey: true });

    expect(await editor.point(last)).toBeNear({ x: 350, y: 100 + 50 * ROOT_3 });
    expect(await editor.point(middle)).toMatchObject({ x: 300, y: 100 });
  });

  it("snaps a two-line junction around itself", async () => {
    const { first, middle, last } = await editor.draw({ contours: [CORNER] });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 330, y: 140 }, { shiftKey: true });

    expect(await editor.point(middle)).toBeNear({ x: 325, y: 100 + 25 * ROOT_3 });
    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(last)).toMatchObject({ x: 300, y: 300 });
  });

  it("recognises both lines at a closed contour's first point", async () => {
    const { first } = await editor.draw({ contours: [CLOSED_CORNER] });

    await editor.dragFrom({ x: 100, y: 100 }, { x: 130, y: 140 }, { shiftKey: true });

    expect(await editor.point(first)).toBeNear({ x: 125, y: 100 + 25 * ROOT_3 });
  });

  it("pivots on the next line point when a curve enters the dragged point", async () => {
    const { middle, last } = await editor.draw({ contours: [CORNER_CURVING_FIRST] });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 240, y: 220 }, { shiftKey: true });

    expect(await editor.point(middle)).toBeNear({ x: 250, y: 300 - 50 * ROOT_3 });
    expect(await editor.point(last)).toMatchObject({ x: 300, y: 300 });
  });

  it("pivots on itself when an incoming line is followed by a curve", async () => {
    const { middle } = await editor.draw({ contours: [CORNER_CURVING_SECOND] });

    await editor.dragFrom({ x: 300, y: 100 }, { x: 330, y: 140 }, { shiftKey: true });

    expect(await editor.point(middle)).toBeNear({ x: 325, y: 100 + 25 * ROOT_3 });
  });

  it("pivots on itself at the last point of an open curve", async () => {
    const { last } = await editor.draw({ contours: [CORNER_CURVING_SECOND] });

    await editor.dragFrom({ x: 300, y: 300 }, { x: 330, y: 340 }, { shiftKey: true });

    expect(await editor.point(last)).toBeNear({ x: 325, y: 300 + 25 * ROOT_3 });
  });

  it("leaves movement free without Shift", async () => {
    const { first } = await editor.draw({ contours: [CORNER] });

    await editor.dragFrom({ x: 100, y: 100 }, { x: 220, y: 160 });

    expect(await editor.point(first)).toMatchObject({ x: 220, y: 160 });
  });

  it("does not snap a selection of several points", async () => {
    const { first, last } = await editor.draw({ contours: [CORNER] });
    editor.select([first, last]);

    await editor.dragFrom({ x: 200, y: 200 }, { x: 230, y: 240 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 130, y: 140 });
    expect(await editor.point(last)).toMatchObject({ x: 330, y: 340 });
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
      const { first, last } = await editor.draw({ contours: [CORNER] });
      editor.select([first, last]);

      editor.pressAt(down);
      editor.movePointerTo(to, { shiftKey: true });
      expect(editor.toolState()).toMatchObject({ state: "resizing" });
      await editor.releaseAt(to);

      expect(await editor.point(first)).toMatchObject(firstAfter);
      expect(await editor.point(last)).toMatchObject(lastAfter);
    },
  );

  it("commits a snapped move as one edit", async () => {
    const { first } = await editor.draw({ contours: [CORNER] });

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 100, y: 100 }, { x: 220, y: 160 }, { shiftKey: true }),
      async (e) => expect(await e.point(first)).toBeNear({ x: 300 - 50 * ROOT_3, y: 150 }),
    );
  });
});
