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

function expectNear(actual: Point2D | undefined, expected: Point2D): void {
  expect(actual?.x).toBeCloseTo(expected.x);
  expect(actual?.y).toBeCloseTo(expected.y);
}

async function position(id: PointId, from: EditorTestSurface = editor): Promise<Point2D> {
  return (await from.pointPositions([id]))[id]!;
}

function shown(id: PointId): Point2D {
  return editor.shownPointPositions([id])[id]!;
}

describe("Shift-dragging one handle snaps its angle around its own point", () => {
  /** Two flat curves meeting smoothly at 400,100. */
  function twoCurves() {
    return editor.draw({
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
    });
  }

  it.each([
    { handle: "controlStart", pivot: { x: 100, y: 100 }, to: { x: 180, y: 160 }, side: 1 },
    { handle: "controlEnd", pivot: { x: 400, y: 100 }, to: { x: 320, y: 160 }, side: -1 },
  ] as const)(
    "snaps $handle around its own point rather than where the drag began",
    async ({ handle, pivot, to, side }) => {
      const points = await twoCurves();
      const id = points[handle];
      const from = await position(id);

      await editor.dragFrom(from, to, { shiftKey: true });

      expectNear(await position(id), { x: pivot.x + side * 50 * ROOT_3, y: 150 });
      expect(editor.selectionIds()).toEqual([id]);
    },
  );

  it.each([
    { handle: "controlStart", pivot: { x: 100, y: 100 }, to: { x: 180, y: 160 } },
    { handle: "controlEnd", pivot: { x: 400, y: 100 }, to: { x: 320, y: 160 } },
  ] as const)(
    "shows a guide from the handle's point to the snapped $handle on the first sample",
    async ({ handle, pivot, to }) => {
      const points = await twoCurves();
      const id = points[handle];

      editor.pressAt(await position(id));
      editor.movePointerTo(to, { shiftKey: true });

      expect(editor.toolState()?.state).toBe("translating");
      expect(editor.drawnSnapGuides()).toMatchObject([{ from: pivot, to: shown(id) }]);
      await editor.pressKey("Escape");
      expect(editor.toolState()?.state).toBe("ready");
    },
  );

  it("leaves a lone handle free without Shift", async () => {
    const { controlStart } = await twoCurves();

    await editor.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 });

    expect(await position(controlStart)).toEqual({ x: 180, y: 160 });
  });

  it("follows Shift on each sample of the drag", async () => {
    const { controlStart } = await twoCurves();
    const to = { x: 180, y: 160 };

    editor.pressAt({ x: 200, y: 100 });
    editor.movePointerTo(to);
    expect(shown(controlStart)).toEqual(to);
    editor.movePointerTo(to, { shiftKey: true });
    expect(shown(controlStart).x).toBeCloseTo(100 + 50 * ROOT_3);
    editor.movePointerTo(to);
    expect(shown(controlStart)).toEqual(to);
    expect(editor.drawnSnapGuides()).toEqual([]);
    await editor.pressKey("Escape");

    expect(shown(controlStart)).toEqual({ x: 200, y: 100 });
  });

  it.each([false, true])(
    "keeps the snapped position when the release reports Shift %s",
    async (shiftKey) => {
      const { controlStart } = await twoCurves();
      const to = { x: 180, y: 160 };

      editor.pressAt({ x: 200, y: 100 });
      editor.movePointerTo(to, { shiftKey: true });
      await editor.releaseAt(to, { shiftKey });

      expect(editor.toolState()?.state).toBe("ready");
      expectNear(await position(controlStart), { x: 100 + 50 * ROOT_3, y: 150 });
    },
  );

  it("snaps the last pointer move even when it is still queued at release", async () => {
    const { controlStart } = await twoCurves();
    const end = { x: 220, y: 190 };

    editor.pressAt({ x: 200, y: 100 });
    editor.movePointerTo({ x: 180, y: 160 }, { shiftKey: true });
    editor.queuePointerMove(end, { shiftKey: true });
    await editor.releaseAt(end);

    expectNear(await position(controlStart), { x: 100 + 75 * ROOT_3, y: 175 });
  });

  it("drops the preview when another tool is chosen, and the next drag starts without Shift", async () => {
    const { controlStart } = await twoCurves();

    editor.pressAt({ x: 200, y: 100 });
    editor.movePointerTo({ x: 180, y: 160 }, { shiftKey: true });
    expect(shown(controlStart).x).toBeCloseTo(100 + 50 * ROOT_3);
    editor.selectTool("pen");
    expect(shown(controlStart)).toEqual({ x: 200, y: 100 });
    editor.selectTool("select");
    expect(editor.toolState()?.state).toBe("ready");

    await editor.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 });

    expect(await position(controlStart)).toEqual({ x: 180, y: 160 });
  });

  it("commits a snapped handle move as one edit", async () => {
    const { controlStart } = await twoCurves();

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 }, { shiftKey: true }),
      async (e) => expectNear(await position(controlStart, e), { x: 100 + 50 * ROOT_3, y: 150 }),
    );
  });

  it("does not snap a selection of several handles", async () => {
    const { controlStart, controlEnd } = await twoCurves();
    editor.select([controlStart, controlEnd]);

    await editor.dragFrom({ x: 200, y: 100 }, { x: 180, y: 160 }, { shiftKey: true });

    expect(await editor.pointPositions([controlStart, controlEnd])).toEqual({
      [controlStart]: { x: 180, y: 160 },
      [controlEnd]: { x: 280, y: 160 },
    });
  });

  it("snaps a curve's on-curve point around where it was", async () => {
    const { start } = await twoCurves();

    await editor.dragFrom({ x: 100, y: 100 }, { x: 130, y: 140 }, { shiftKey: true });

    expectNear(await position(start), { x: 125, y: 100 + 25 * ROOT_3 });
  });

  it("keeps the opposite handle's length and the smooth tangent after snapping", async () => {
    const { controlEnd, junction, outgoing } = await twoCurves();

    await editor.dragFrom({ x: 300, y: 100 }, { x: 320, y: 160 }, { shiftKey: true });

    expectNear(await position(controlEnd), { x: 400 - 50 * ROOT_3, y: 150 });
    expectNear(await position(outgoing), { x: 400 + 50 * ROOT_3, y: 50 });
    expect(await position(junction)).toEqual({ x: 400, y: 100 });
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

    expect(editor.toolState()?.state).toBe("translating");
    expect(editor.drawnSnapGuides()).toEqual([]);
    expect(shown(handle).y).toBeCloseTo(100);
    await editor.pressKey("Escape");
  });
});
