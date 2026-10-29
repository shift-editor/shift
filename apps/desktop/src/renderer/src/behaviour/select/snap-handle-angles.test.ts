import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import type { GlyphFixture } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const ROOT_3 = Math.sqrt(3);

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("select");
});

/** Two flat curves meeting smoothly at 400,100. */
const TWO_CURVES = {
  contours: [
    {
      points: [
        { x: 100, y: 100, name: "start" },
        { x: 200, y: 100, off: true, name: "controlStart" },
        { x: 300, y: 100, off: true, name: "controlEnd" },
        { x: 400, y: 100, smooth: true, name: "junction" },
        { x: 500, y: 100, off: true, name: "outgoing" },
        { x: 600, y: 100, off: true },
        [700, 100],
      ],
    },
  ],
} as const satisfies GlyphFixture;

describe("Shift-dragging one handle snaps its angle around its own point", () => {
  it.each([
    { handle: "controlStart", pivot: { x: 100, y: 100 }, to: { x: 180, y: 160 }, side: 1 },
    { handle: "controlEnd", pivot: { x: 400, y: 100 }, to: { x: 320, y: 160 }, side: -1 },
  ] as const)(
    "snaps $handle around its own point rather than where the drag began",
    async ({ handle, pivot, to, side }) => {
      const points = await editor.draw(TWO_CURVES);
      const id = points[handle];
      const from = (await editor.point(id))!;

      await editor.dragFrom(from, to, { shiftKey: true });

      expect(await editor.point(id)).toBeNear({ x: pivot.x + side * 50 * ROOT_3, y: 150 });
      expect(editor.selectionIds()).toEqual([id]);
    },
  );

  it.each([
    { handle: "controlStart", pivot: { x: 100, y: 100 }, to: { x: 180, y: 160 }, side: 1 },
    { handle: "controlEnd", pivot: { x: 400, y: 100 }, to: { x: 320, y: 160 }, side: -1 },
  ] as const)(
    "shows a guide from the handle's point to the snapped $handle on the first sample",
    async ({ handle, pivot, to, side }) => {
      const points = await editor.draw(TWO_CURVES);
      const id = points[handle];
      const snapped = { x: pivot.x + side * 50 * ROOT_3, y: 150 };

      editor.pressAt((await editor.point(id))!);
      editor.movePointerTo(to, { shiftKey: true });

      expect(editor.toolState()).toMatchObject({ state: "translating" });
      expect(editor.drawnPoint(id)).toBeNear(snapped);
      expect(editor.drawnSnapGuides()).toMatchObject([
        { from: pivot, to: expect.toBeNear(snapped) },
      ]);
      await editor.pressKey("Escape");
      expect(editor.toolState()).toMatchObject({ state: "ready" });
    },
  );

  it("leaves a lone handle free without Shift", async () => {
    const { controlStart } = await editor.draw(TWO_CURVES);

    await editor.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 });

    expect(await editor.point(controlStart)).toMatchObject({ x: 180, y: 160 });
  });

  it("follows Shift on each sample of the drag", async () => {
    const { controlStart } = await editor.draw(TWO_CURVES);
    const to = { x: 180, y: 160 };

    editor.pressAt({ x: 200, y: 100 });
    editor.movePointerTo(to);
    expect(editor.drawnPoint(controlStart)).toMatchObject(to);
    editor.movePointerTo(to, { shiftKey: true });
    expect(editor.drawnPoint(controlStart)).toMatchObject({ x: expect.closeTo(100 + 50 * ROOT_3) });
    editor.movePointerTo(to);
    expect(editor.drawnPoint(controlStart)).toMatchObject(to);
    expect(editor.drawnSnapGuides()).toEqual([]);
    await editor.pressKey("Escape");

    expect(editor.drawnPoint(controlStart)).toMatchObject({ x: 200, y: 100 });
  });

  it.each([false, true])(
    "keeps the snapped position when the release reports Shift %s",
    async (shiftKey) => {
      const { controlStart } = await editor.draw(TWO_CURVES);
      const to = { x: 180, y: 160 };

      editor.pressAt({ x: 200, y: 100 });
      editor.movePointerTo(to, { shiftKey: true });
      await editor.releaseAt(to, { shiftKey });

      expect(editor.toolState()).toMatchObject({ state: "ready" });
      expect(await editor.point(controlStart)).toBeNear({ x: 100 + 50 * ROOT_3, y: 150 });
    },
  );

  it("snaps the last pointer move even when it is still queued at release", async () => {
    const { controlStart } = await editor.draw(TWO_CURVES);
    const end = { x: 220, y: 190 };

    editor.pressAt({ x: 200, y: 100 });
    editor.movePointerTo({ x: 180, y: 160 }, { shiftKey: true });
    editor.queuePointerMove(end, { shiftKey: true });
    await editor.releaseAt(end);

    expect(await editor.point(controlStart)).toBeNear({ x: 100 + 75 * ROOT_3, y: 175 });
  });

  it("drops the preview when another tool is chosen, and the next drag starts without Shift", async () => {
    const { controlStart } = await editor.draw(TWO_CURVES);

    editor.pressAt({ x: 200, y: 100 });
    editor.movePointerTo({ x: 180, y: 160 }, { shiftKey: true });
    expect(editor.drawnPoint(controlStart)).toMatchObject({ x: expect.closeTo(100 + 50 * ROOT_3) });
    editor.selectTool("pen");
    expect(editor.drawnPoint(controlStart)).toMatchObject({ x: 200, y: 100 });
    editor.selectTool("select");
    expect(editor.toolState()).toMatchObject({ state: "ready" });

    await editor.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 });

    expect(await editor.point(controlStart)).toMatchObject({ x: 180, y: 160 });
  });

  it("commits a snapped handle move as one edit", async () => {
    const { controlStart } = await editor.draw(TWO_CURVES);

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 }, { shiftKey: true }),
      async (e) => expect(await e.point(controlStart)).toBeNear({ x: 100 + 50 * ROOT_3, y: 150 }),
    );
  });

  it("does not snap a selection of several handles", async () => {
    const { controlStart, controlEnd } = await editor.draw(TWO_CURVES);
    editor.select([controlStart, controlEnd]);

    await editor.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 }, { shiftKey: true });

    expect(await editor.point(controlStart)).toMatchObject({ x: 180, y: 160 });
    expect(await editor.point(controlEnd)).toMatchObject({ x: 280, y: 160 });
  });

  it("snaps a curve's on-curve point around where it was", async () => {
    const { start } = await editor.draw(TWO_CURVES);

    await editor.dragFrom({ x: 100, y: 100 }, { x: 130, y: 140 }, { shiftKey: true });

    expect(await editor.point(start)).toBeNear({ x: 125, y: 100 + 25 * ROOT_3 });
  });

  it("keeps the opposite handle's length and the smooth tangent after snapping", async () => {
    const { controlEnd, junction, outgoing } = await editor.draw(TWO_CURVES);

    await editor.dragFrom({ x: 300, y: 100 }, { x: 320, y: 160 }, { shiftKey: true });

    expect(await editor.point(controlEnd)).toBeNear({ x: 400 - 50 * ROOT_3, y: 150 });
    expect(await editor.point(outgoing)).toBeNear({ x: 400 + 50 * ROOT_3, y: 50 });
    expect(await editor.point(junction)).toMatchObject({ x: 400, y: 100 });
  });
});

describe("Shift-dragging a handle locked to a line does not snap its angle", () => {
  it("shows no guide and keeps the handle on the line", async () => {
    const { handle } = await editor.draw({
      contours: [
        {
          points: [
            [100, 100],
            { x: 400, y: 100, smooth: true },
            { x: 500, y: 100, off: true, name: "handle" },
            { x: 600, y: 300, off: true },
            [700, 300],
          ],
        },
      ],
    });

    editor.pressAt({ x: 500, y: 100 });
    editor.movePointerTo({ x: 560, y: 160 }, { shiftKey: true });

    expect(editor.toolState()).toMatchObject({ state: "translating" });
    expect(editor.drawnSnapGuides()).toEqual([]);
    expect(editor.drawnPoint(handle)).toMatchObject({ y: expect.closeTo(100) });
    await editor.pressKey("Escape");
  });
});
