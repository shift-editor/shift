import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { ContourFixture } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

const FIRST = { x: 100, y: 100, name: "first" } as const;
const MIDDLE = { x: 300, y: 100, name: "middle" } as const;
const LAST = { x: 300, y: 300, name: "last" } as const;

/** An open L of two lines, 100,100 → 300,100 → 300,300. */
const CORNER = { points: [FIRST, MIDDLE, LAST] } satisfies ContourFixture;
/** {@link CORNER} closed back to its first point. */
const CLOSED_CORNER = { ...CORNER, closed: true } satisfies ContourFixture;
/** {@link CORNER} with its first line a curve. */
const CURVED_CORNER = {
  points: [
    FIRST,
    { x: 167, y: 100, off: true, name: "controlStart" },
    { x: 233, y: 100, off: true, name: "controlEnd" },
    MIDDLE,
    LAST,
  ],
} as const satisfies ContourFixture;

describe("Shift-dragging segments moves them in 90-degree steps", () => {
  it.each([false, true])("snaps a line already selected: %s", async (selected) => {
    const { first, middle, last } = await editor.draw({ contours: [CORNER] });
    if (selected) await editor.clickAt({ x: 150, y: 100 });

    await editor.dragFrom({ x: 150, y: 100 }, { x: 210, y: 180 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 200 });
    expect(await editor.point(middle)).toMatchObject({ x: 300, y: 200 });
    expect(await editor.point(last)).toMatchObject({ x: 300, y: 300 });
  });

  it("moves several selected segments together without moving their shared point twice", async () => {
    const { first, middle, last } = await editor.draw({ contours: [CLOSED_CORNER] });
    await editor.clickAt({ x: 150, y: 100 });
    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });
    expect(editor.selectionIds()).toEqual([
      editor.segmentBetween(first, middle),
      editor.segmentBetween(last, first),
    ]);

    await editor.dragFrom({ x: 200, y: 200 }, { x: 260, y: 280 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 200 });
    expect(await editor.point(middle)).toMatchObject({ x: 300, y: 200 });
    expect(await editor.point(last)).toMatchObject({ x: 300, y: 400 });
  });

  it("moves the selected segments when dragging inside their combined bounds", async () => {
    const { first, middle, last } = await editor.draw({ contours: [CORNER] });
    await editor.clickAt({ x: 150, y: 100 });
    await editor.clickAt({ x: 300, y: 150 }, { shiftKey: true });

    await editor.dragFrom({ x: 200, y: 200 }, { x: 280, y: 260 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 200, y: 100 });
    expect(await editor.point(middle)).toMatchObject({ x: 400, y: 100 });
    expect(await editor.point(last)).toMatchObject({ x: 400, y: 300 });
  });

  it("shows no guide for a horizontal or vertical segment move", async () => {
    await editor.draw({ contours: [CORNER] });
    await editor.clickAt({ x: 150, y: 100 });
    await editor.clickAt({ x: 300, y: 150 }, { shiftKey: true });

    editor.pressAt({ x: 200, y: 200 });
    editor.movePointerTo({ x: 280, y: 260 }, { shiftKey: true });
    editor.movePointerTo({ x: 280, y: 260 }, { shiftKey: true });

    expect(editor.toolState()).toMatchObject({ state: "translating" });
    expect(editor.drawnSnapGuides()).toEqual([]);
    await editor.pressKey("Escape");
    expect(editor.toolState()).toMatchObject({ state: "ready" });
  });

  it("moves a curve segment without changing its shape", async () => {
    const { first, middle, controlStart, controlEnd } = await editor.draw({
      contours: [CURVED_CORNER],
    });
    await editor.clickAt({ x: 200, y: 100 });

    await editor.dragFrom({ x: 200, y: 100 }, { x: 260, y: 180 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 200 });
    expect(await editor.point(controlStart)).toMatchObject({ x: 167, y: 200 });
    expect(await editor.point(controlEnd)).toMatchObject({ x: 233, y: 200 });
    expect(await editor.point(middle)).toMatchObject({ x: 300, y: 200 });
  });

  it("moves freely when a point is selected alongside the segment", async () => {
    const { first, middle, last } = await editor.draw({ contours: [CLOSED_CORNER] });
    await editor.clickAt({ x: 200, y: 200 });
    await editor.clickAt({ x: 300, y: 100 }, { shiftKey: true });
    expect(editor.selectionIds()).toEqual([editor.segmentBetween(last, first), middle]);

    await editor.dragFrom({ x: 200, y: 200 }, { x: 260, y: 280 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 160, y: 180 });
    expect(await editor.point(middle)).toMatchObject({ x: 360, y: 180 });
    expect(await editor.point(last)).toMatchObject({ x: 360, y: 380 });
  });

  it("moves freely when an anchor is selected alongside the segment", async () => {
    const { first } = await editor.draw({ contours: [CLOSED_CORNER] });
    await editor.draw({ anchors: [{ name: "top", x: 500, y: 500 }] });
    await editor.clickAt({ x: 200, y: 200 });
    await editor.clickAt({ x: 500, y: 500 }, { shiftKey: true });

    await editor.dragFrom({ x: 200, y: 200 }, { x: 260, y: 280 }, { shiftKey: true });

    expect(await editor.point(first)).toMatchObject({ x: 160, y: 180 });
    expect(await editor.anchors()).toMatchObject([{ name: "top", x: 560, y: 580 }]);
  });

  it("resizes from a selection edge even where a selected segment lies on it", async () => {
    const { first, middle, last } = await editor.draw({ contours: [CORNER] });
    await editor.clickAt({ x: 150, y: 100 });
    await editor.clickAt({ x: 300, y: 150 }, { shiftKey: true });

    editor.pressAt({ x: 150, y: 100 });
    editor.movePointerTo({ x: 210, y: 180 }, { shiftKey: true });
    expect(editor.toolState()).toMatchObject({ state: "resizing" });
    await editor.releaseAt({ x: 210, y: 180 });

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 180 });
    expect(await editor.point(middle)).toMatchObject({ x: 300, y: 180 });
    expect(await editor.point(last)).toMatchObject({ x: 300, y: 300 });
  });

  it("resizes from a selection corner even where a selected segment ends on it", async () => {
    const { first } = await editor.draw({ contours: [CORNER] });
    await editor.clickAt({ x: 150, y: 100 });
    await editor.clickAt({ x: 300, y: 150 }, { shiftKey: true });

    editor.pressAt({ x: 100, y: 100 });
    editor.movePointerTo({ x: 130, y: 140 }, { shiftKey: true });
    expect(editor.toolState()).toMatchObject({ state: "resizing" });
    await editor.pressKey("Escape");

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
  });

  it("moves a segment freely without Shift", async () => {
    const { first, middle } = await editor.draw({ contours: [CORNER] });

    await editor.dragFrom({ x: 150, y: 100 }, { x: 210, y: 180 });

    expect(await editor.point(first)).toMatchObject({ x: 160, y: 180 });
    expect(await editor.point(middle)).toMatchObject({ x: 360, y: 180 });
  });

  it("recomputes from where the drag began as Shift toggles, and Escape puts it back", async () => {
    const { first, middle } = await editor.draw({ contours: [CORNER] });
    const to = { x: 210, y: 180 };

    editor.pressAt({ x: 150, y: 100 });
    editor.movePointerTo(to, { shiftKey: true });
    expect(editor.drawnPoint(first)).toMatchObject({ x: 100, y: 200 });
    editor.movePointerTo(to);
    expect(editor.drawnPoint(first)).toMatchObject({ x: 160, y: 180 });
    expect(editor.drawnSnapGuides()).toEqual([]);
    editor.movePointerTo(to, { shiftKey: true });
    expect(editor.drawnPoint(first)).toMatchObject({ x: 100, y: 200 });
    await editor.pressKey("Escape");

    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });
    expect(await editor.point(middle)).toMatchObject({ x: 300, y: 100 });
  });

  it("commits the last Shift sample, even when still queued at release, as one edit", async () => {
    const { first } = await editor.draw({ contours: [CORNER] });

    await expectEdit(
      editor,
      async (e) => {
        e.pressAt({ x: 150, y: 100 });
        e.movePointerTo({ x: 180, y: 140 }, { shiftKey: true });
        e.queuePointerMove({ x: 210, y: 180 }, { shiftKey: true });
        await e.releaseAt({ x: 210, y: 180 });
      },
      { [first]: { x: 100, y: 200 } },
    );
  });
});
