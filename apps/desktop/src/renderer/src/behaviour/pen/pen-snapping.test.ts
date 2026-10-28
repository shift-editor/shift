import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import { expectEdit } from "@/testing/expectEdit";
import { offCurve, onCurve } from "@/testing/outlineMatchers";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("pen");
});

/** The handle mirrored through the anchor at (300, 100), as a curve drag pulls it. */
function mirroredThroughAnchor(control: Point2D): Point2D {
  return { x: 600 - control.x, y: 200 - control.y };
}

describe("the Pen snaps new points to metrics and existing points", () => {
  it("snaps the first point of a contour to the x-height", async () => {
    const { xHeight } = editor.metrics();
    if (xHeight === undefined) throw new Error("Expected the test font to author an x-height");

    await editor.clickAt({ x: 200, y: xHeight - editor.hitDistance() / 2 });

    expect((await editor.outline())[0]?.points).toMatchObject([onCurve(200, xHeight)]);
  });

  it("lines a new point up with an earlier one", async () => {
    await editor.clickAt({ x: 100, y: 120 });
    await editor.clickAt({ x: 300, y: 120 + editor.hitDistance() / 2 });

    expect((await editor.outline())[0]?.points[1]).toMatchObject(onCurve(300, 120));
  });

  it("places the point exactly where clicked while Cmd is held", async () => {
    const { xHeight } = editor.metrics();
    if (xHeight === undefined) throw new Error("Expected the test font to author an x-height");
    const near = xHeight - editor.hitDistance() / 2;

    await editor.clickAt({ x: 200, y: near }, { metaKey: true });

    expect((await editor.outline())[0]?.points).toMatchObject([onCurve(200, near)]);
  });

  it("lands a new point exactly on a nearby point instead of splitting its segment", async () => {
    await editor.draw({
      contours: [
        {
          closed: true,
          points: [
            [100, 100],
            [100, 300],
            [300, 300],
            [300, 100],
          ],
        },
      ],
    });
    const near = editor.hitDistance() / 3;

    await editor.clickAt({ x: 300 - near, y: 300 - near });

    const [square, started] = await editor.outline();
    expect(square?.points).toHaveLength(4);
    expect(started?.points).toMatchObject([onCurve(300, 300)]);
  });
});

describe("Shift constrains the Pen's handles and points to set directions", () => {
  beforeEach(async () => {
    await editor.clickAt({ x: 100, y: 100 });
  });

  it.each([
    { pointer: { x: 380, y: 120 }, angle: 15 },
    { pointer: { x: 380, y: 160 }, angle: 30 },
    { pointer: { x: 330, y: 140 }, angle: 60 },
  ])(
    "shows the whole curve with its handle snapped to $angle degrees, and a direction guide",
    async ({ pointer, angle }) => {
      editor.holdDragFrom({ x: 300, y: 100 }, pointer, { shiftKey: true });

      const length = Math.hypot(pointer.x - 300, pointer.y - 100);
      const radians = (angle * Math.PI) / 180;
      const incoming = {
        x: 300 - length * Math.cos(radians),
        y: 100 - length * Math.sin(radians),
      };
      const outgoing = mirroredThroughAnchor(incoming);
      expect(editor.drawnOutline()[0]?.points).toMatchObject([
        onCurve(100, 100),
        { pointType: "offCurve" },
        offCurve(incoming.x, incoming.y),
        onCurve(300, 100),
      ]);
      expect(editor.drawnSnapGuides()).toMatchObject([
        {
          kind: "direction",
          from: { x: 300, y: 100 },
          to: { x: expect.closeTo(outgoing.x, 6), y: expect.closeTo(outgoing.y, 6) },
        },
      ]);

      await editor.pressKey("Escape");
      expect(editor.drawnOutline()[0]?.points).toHaveLength(1);
      expect(editor.toolState()).toEqual({ id: "pen", state: "ready" });
    },
  );

  it("follows Shift on the current pointer sample without stacking previews", async () => {
    editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 160 });
    expect(editor.drawnOutline()[0]?.points[2]).toMatchObject(offCurve(220, 40));

    editor.movePointerTo({ x: 380, y: 160 }, { shiftKey: true });
    expect(editor.drawnOutline()[0]?.points[2]?.y).toBeCloseTo(50);

    editor.movePointerTo({ x: 380, y: 160 });
    expect(editor.drawnSnapGuides()).toEqual([]);
    expect(editor.drawnOutline()[0]?.points[2]).toMatchObject(offCurve(220, 40));
    await editor.pressKey("Escape");
  });

  it("shows a direction guide while Shift snaps a closing drag", async () => {
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });
    await editor.clickAt({ x: 300, y: 300 });

    editor.holdDragFrom({ x: 100, y: 100 }, { x: 100, y: 162 }, { shiftKey: true });

    expect(editor.drawnSnapGuides()).toMatchObject([
      { kind: "direction", from: { x: 100, y: 100 } },
    ]);
    await editor.pressKey("Escape");
  });

  it("shows a direction guide for a handle snapped horizontal", async () => {
    editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 100 }, { shiftKey: true });

    expect(editor.drawnSnapGuides()).toMatchObject([
      {
        kind: "direction",
        from: { x: 300, y: 100 },
        to: { x: expect.closeTo(380, 6), y: expect.closeTo(100, 6) },
      },
    ]);
    await editor.pressKey("Escape");
  });

  it.each([false, true])(
    "keeps the constrained handle when the release reports shiftKey=%s",
    async (shiftKey) => {
      editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { shiftKey: true });
      const preview = editor.drawnOutline()[0]?.points[2];
      expect(preview).toMatchObject(offCurve(300 - 50 * Math.sqrt(3), 50));

      await editor.releaseAt({ x: 380, y: 160 }, { shiftKey });

      expect(editor.toolState()).toEqual({ id: "pen", state: "ready" });
      expect((await editor.outline())[0]?.points[2]).toEqual(preview);
    },
  );

  it("commits the release position while leaving the anchor and first control fixed", async () => {
    editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { shiftKey: true });

    await editor.releaseAt({ x: 420, y: 190 });

    expect((await editor.outline())[0]?.points).toMatchObject([
      onCurve(100, 100),
      offCurve(100 + 200 / 3, 100),
      offCurve(300 - 75 * Math.sqrt(3), 25),
      onCurve(300, 100),
    ]);
  });

  it("adds the snapped curve as one undoable step", async () => {
    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { shiftKey: true }),
      async (e) => {
        const points = (await e.outline())[0]?.points;
        expect(points).toHaveLength(4);
        expect(points?.[2]?.y).toBeCloseTo(50);
      },
    );
  });

  it("carries the snapped outgoing handle into the next curve", async () => {
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { shiftKey: true });
    await editor.dragFrom({ x: 500, y: 100 }, { x: 580, y: 180 });

    expect((await editor.outline())[0]?.points.slice(2, 6)).toMatchObject([
      offCurve(300 - 50 * Math.sqrt(3), 50),
      { ...onCurve(300, 100), smooth: true },
      offCurve(300 + 50 * Math.sqrt(3), 150),
      offCurve(420, 20),
    ]);
  });

  it("drops a snapped curve on Escape without bending the curve before it", async () => {
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { shiftKey: true });
    const before = editor.drawnOutline();

    editor.holdDragFrom({ x: 500, y: 100 }, { x: 580, y: 160 }, { shiftKey: true });
    expect(editor.drawnOutline()[0]?.points).toHaveLength(7);

    await editor.pressKey("Escape");
    expect(editor.drawnOutline()).toEqual(before);
  });

  it("drops the curve being dragged when another tool is chosen", () => {
    editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { shiftKey: true });
    expect(editor.drawnOutline()[0]?.points).toHaveLength(4);

    editor.selectTool("select");
    expect(editor.drawnOutline()[0]?.points).toMatchObject([onCurve(100, 100)]);

    editor.selectTool("pen");
    expect(editor.toolState()).toEqual({ id: "pen", state: "ready" });
  });

  it("lets the pointer come back onto the anchor", async () => {
    editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 160 }, { shiftKey: true });

    editor.movePointerTo({ x: 300, y: 100 }, { shiftKey: true });

    expect(editor.drawnOutline()[0]?.points[2]).toMatchObject(offCurve(300, 100));
    await editor.pressKey("Escape");
  });

  it("snaps a Shift-click to 15 degree steps around the previous point", async () => {
    await editor.clickAt({ x: 300, y: 160 }, { shiftKey: true });

    const length = Math.hypot(200, 60);
    expect((await editor.outline())[0]?.points).toMatchObject([
      onCurve(100, 100),
      onCurve(100 + length * Math.cos(Math.PI / 12), 100 + length * Math.sin(Math.PI / 12)),
    ]);
  });

  it("snaps the anchor of a Shift-dragged curve the same way", async () => {
    await editor.dragFrom({ x: 300, y: 160 }, { x: 380, y: 240 }, { shiftKey: true });

    const length = Math.hypot(200, 60);
    expect((await editor.outline())[0]?.points[3]).toMatchObject(
      onCurve(100 + length * Math.cos(Math.PI / 12), 100 + length * Math.sin(Math.PI / 12)),
    );
  });
});
