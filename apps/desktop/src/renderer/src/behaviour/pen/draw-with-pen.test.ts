import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { offCurve, onCurve } from "@/testing/outlineMatchers";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("pen");
});

describe("clicking with the Pen draws corners", () => {
  it("places an on-curve point where it is clicked, as one undoable step", async () => {
    await expectEdit(
      editor,
      (e) => e.clickAt({ x: 100, y: 200 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([{ closed: false, points: [onCurve(100, 200)] }]);
      },
    );
  });

  it("joins each new point to the last with a line", async () => {
    await editor.clickAt({ x: 100, y: 200 });
    await editor.clickAt({ x: 300, y: 200 });
    await editor.clickAt({ x: 500, y: 200 });

    expect(await editor.outline()).toMatchObject([
      { closed: false, points: [onCurve(100, 200), onCurve(300, 200), onCurve(500, 200)] },
    ]);
  });

  it("closes the contour on a click on its first point, and starts a new one on the next click", async () => {
    await editor.clickAt({ x: 100, y: 200 });
    await editor.clickAt({ x: 300, y: 200 });
    await editor.clickAt({ x: 200, y: 100 });

    await editor.clickAt({ x: 100, y: 200 });

    expect(await editor.outline()).toMatchObject([
      { closed: true, points: [onCurve(100, 200), onCurve(300, 200), onCurve(200, 100)] },
    ]);

    await editor.clickAt({ x: 600, y: 600 });
    expect(await editor.outline()).toMatchObject([
      { closed: true },
      { closed: false, points: [onCurve(600, 600)] },
    ]);
  });

  it("leaves nothing selected that undo removed, and redo restores the selection", async () => {
    await editor.clickAt({ x: 100, y: 200 });
    const selection = editor.selectionIds();

    await editor.undo();
    expect(editor.selectionIds()).toEqual([]);

    await editor.redo();
    expect(editor.selectionIds()).toEqual(selection);
  });
});

describe("dragging with the Pen draws curves", () => {
  it("shows the whole curve while the drag is held and keeps it on release", async () => {
    await editor.clickAt({ x: 100, y: 100 });

    editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });
    await editor.settle();
    expect(editor.drawnOutline()).toMatchObject([
      {
        points: [
          { pointType: "onCurve" },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { pointType: "onCurve" },
        ],
      },
    ]);

    await editor.releaseAt({ x: 380, y: 180 });
    expect(await editor.outline()).toMatchObject([
      {
        points: [
          { pointType: "onCurve" },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { pointType: "onCurve" },
        ],
      },
    ]);
  });

  it("puts the outline back when Escape cancels the curve being dragged", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    editor.holdDragFrom({ x: 300, y: 100 }, { x: 340, y: 120 });

    await editor.pressKey("Escape");

    expect(editor.drawnOutline()).toMatchObject([{ points: [onCurve(100, 100)] }]);
  });

  it("puts the first control a third of the way along and mirrors the dragged handle into the second, as one undoable step", async () => {
    await editor.clickAt({ x: 100, y: 100 });

    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([
          {
            closed: false,
            points: [
              onCurve(100, 100),
              offCurve(100 + (300 - 100) / 3, 100),
              offCurve(220, 20),
              onCurve(300, 100),
            ],
          },
        ]);
      },
    );
  });

  it("starts the next curve from the handle the last drag pulled out", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });
    await editor.dragFrom({ x: 500, y: 100 }, { x: 580, y: 180 });

    expect(await editor.outline()).toMatchObject([
      {
        points: [
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          offCurve(380, 180),
          expect.anything(),
          expect.anything(),
        ],
      },
    ]);
  });

  it("starts the next curve from the pulled handle even when the drags come faster than the workspace confirms them", async () => {
    await Promise.all([
      editor.clickAt({ x: 100, y: 100 }),
      editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 }),
      editor.dragFrom({ x: 500, y: 100 }, { x: 580, y: 180 }),
    ]);

    expect(await editor.outline()).toMatchObject([
      {
        points: [
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          offCurve(380, 180),
          expect.anything(),
          expect.anything(),
        ],
      },
    ]);
  });

  it("keeps the held curve showing while the curve before it is confirmed, and drops only the held one on Escape", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    const previous = editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });

    editor.holdDragFrom({ x: 500, y: 100 }, { x: 580, y: 180 });
    await previous;

    expect(editor.drawnOutline()).toMatchObject([
      {
        points: [
          { pointType: "onCurve" },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { pointType: "onCurve" },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { pointType: "onCurve" },
        ],
      },
    ]);

    await editor.pressKey("Escape");
    await editor.releaseAt({ x: 580, y: 180 });

    expect(await editor.outline()).toMatchObject([
      {
        points: [
          { pointType: "onCurve" },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { pointType: "onCurve", smooth: false },
        ],
      },
    ]);
  });

  it("joins two dragged curves at a smooth point", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.dragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });

    editor.holdDragFrom({ x: 500, y: 100 }, { x: 580, y: 180 });
    expect(editor.drawnOutline()).toMatchObject([
      {
        points: [
          onCurve(100, 100),
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { ...onCurve(300, 100), smooth: true },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { ...onCurve(500, 100), smooth: false },
        ],
      },
    ]);

    await editor.releaseAt({ x: 580, y: 180 });
    expect(await editor.outline()).toMatchObject([
      {
        points: [
          onCurve(100, 100),
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { ...onCurve(300, 100), smooth: true },
          { pointType: "offCurve" },
          { pointType: "offCurve" },
          { ...onCurve(500, 100), smooth: false },
        ],
      },
    ]);
  });

  it("pulls a handle for the next curve when dragging off a point just placed", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.dragFrom({ x: 100, y: 100 }, { x: 160, y: 180 });
    expect(await editor.outline()).toMatchObject([{ points: [onCurve(100, 100)] }]);

    await editor.dragFrom({ x: 300, y: 100 }, { x: 340, y: 140 });

    expect(await editor.outline()).toMatchObject([
      { points: [expect.anything(), offCurve(160, 180), expect.anything(), expect.anything()] },
    ]);
  });

  it("keeps showing the curve between releasing the drag and the workspace confirming it", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    editor.holdDragFrom({ x: 300, y: 100 }, { x: 380, y: 180 });

    const released = editor.releaseAt({ x: 380, y: 180 });
    expect(editor.drawnOutline()).toMatchObject([{ points: Array(4).fill(expect.anything()) }]);

    await released;
    expect(editor.drawnOutline()).toMatchObject([{ points: Array(4).fill(expect.anything()) }]);
  });
});

describe("panning with Space while drawing", () => {
  it("carries on the same contour after Space lets go of the Hand", async () => {
    await editor.clickAt({ x: 100, y: 200 });
    await editor.clickAt({ x: 300, y: 200 });
    const [before] = await editor.outline();

    editor.holdSpaceForHand();
    editor.releaseSpace();
    await editor.clickAt({ x: 500, y: 200 });

    expect(await editor.outline()).toMatchObject([
      {
        id: before!.id,
        points: [onCurve(100, 200), onCurve(300, 200), onCurve(500, 200)],
      },
    ]);
  });
});

describe("drawing between sources", () => {
  it("does not draw into the last source shown", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 300, y: 100 });
    const before = await editor.outline();
    await editor.addAxis(WEIGHT);
    editor.setLocation({ wght: 550 });

    await editor.clickAt({ x: 300, y: 300 });
    await editor.clickAt({ x: 500, y: 100 });
    await editor.settle();

    editor.clickSource("Regular");
    expect(await editor.outline()).toEqual(before);
  });
});
