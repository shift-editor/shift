import { beforeEach, describe, expect, it } from "vitest";
import { Bounds } from "@shift/geo";
import { cursorToCSS } from "@shift/editor/rendering";
import { expectEdit } from "@/testing/expectEdit";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

const editor = useTestEditor();
beforeEach(() => {
  editor.selectTool("shape");
});

describe("drawing a shape by dragging", () => {
  it("is ready when chosen and hands over to the next tool chosen", () => {
    expect(editor.toolState()).toEqual({ id: "shape", state: "ready" });

    editor.selectTool("select");

    expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
  });

  it("shows the cursor of the shape chosen in the toolbar menu", () => {
    expect(editor.shownCursor()).toBe(cursorToCSS({ type: "crosshair-square" }));

    editor.chooseToolMenuItem("shape", "ellipse");
    expect(editor.shownCursor()).toBe(cursorToCSS({ type: "crosshair-circle" }));

    editor.chooseToolMenuItem("shape", "rectangle");
    expect(editor.shownCursor()).toBe(cursorToCSS({ type: "crosshair-square" }));
  });

  it("adds a closed four-corner rectangle as one undoable step", async () => {
    await expectEdit(
      editor,
      (e) => e.dragFrom({ x: 10, y: 10 }, { x: 110, y: 90 }),
      async (e) => {
        expect(await e.outline()).toMatchObject([
          { closed: true, points: Array(4).fill(expect.anything()) },
        ]);
      },
    );
  });

  it("does not draw into the last source shown at a location between sources", async () => {
    await editor.addAxis(WEIGHT);
    editor.setLocation({ wght: 550 });

    await editor.dragFrom({ x: 10, y: 10 }, { x: 110, y: 90 });

    editor.clickSource("Regular");
    expect(await editor.outline()).toEqual([]);
  });

  it("selects the new shape and goes back to the Select tool", async () => {
    await editor.dragFrom({ x: 10, y: 10 }, { x: 110, y: 90 });

    const [created] = await editor.outline();
    expect(editor.selectionIds()).toEqual([created?.id]);
    expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
  });

  it("draws an ellipse of four smooth curves when Ellipse is chosen", async () => {
    editor.chooseToolMenuItem("shape", "ellipse");

    await editor.dragFrom({ x: 10, y: 20 }, { x: 210, y: 120 });

    const [created] = await editor.outline();
    expect(created).toMatchObject({
      closed: true,
      points: Array.from({ length: 4 }, () => [
        { pointType: "onCurve", smooth: true },
        { pointType: "offCurve", smooth: false },
        { pointType: "offCurve", smooth: false },
      ]).flat(),
    });
    expect(await editor.outlineBounds()).toEqual({
      min: { x: 10, y: 20 },
      max: { x: 210, y: 120 },
    });
    expect(editor.selectionIds()).toEqual([created?.id]);
    expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
  });

  it("adds nothing when Escape cancels the drag", async () => {
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 110, y: 90 });

    await editor.pressKey("Escape");

    expect(await editor.outline()).toEqual([]);
    expect(editor.toolState()).toEqual({ id: "shape", state: "ready" });
  });

  it("adds nothing for a drag that ends under three units across", async () => {
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 14, y: 14 });
    editor.movePointerTo({ x: 12, y: 12 });

    await editor.releaseAt({ x: 12, y: 12 });

    expect(await editor.outline()).toEqual([]);
  });
});

describe.each(["rectangle", "ellipse"] as const)("drawing a %s", (kind) => {
  const cursor = cursorToCSS({
    type: kind === "ellipse" ? "crosshair-circle" : "crosshair-square",
  });

  beforeEach(() => {
    editor.chooseToolMenuItem("shape", kind);
  });

  it.each([
    { x: 210, y: 120 },
    { x: -190, y: 120 },
    { x: 210, y: -80 },
    { x: -190, y: -80 },
  ])("fills exactly the box dragged out, in any direction: %j", async (end) => {
    await editor.dragFrom({ x: 10, y: 20 }, end);

    expect(await editor.outlineBounds()).toEqual({
      min: { x: Math.min(10, end.x), y: Math.min(20, end.y) },
      max: { x: Math.max(10, end.x), y: Math.max(20, end.y) },
    });
  });

  it("keeps the shape cursor while drawing and after cancelling", async () => {
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 100, y: 60 });
    expect(editor.shownCursor()).toBe(cursor);

    await editor.pressKey("Escape");
    expect(editor.shownCursor()).toBe(cursor);
  });

  it("adds the same shape it showed while dragging", async () => {
    editor.holdDragFrom({ x: 10, y: 20 }, { x: 210, y: 120 });
    const previewed = editor.drawnOutline();

    await editor.releaseAt({ x: 210, y: 120 });

    expect(await editor.outline()).toEqual(previewed);
  });

  it.each([1, -1])(
    "keeps width and height equal while Shift is held, direction %i",
    async (direction) => {
      await editor.dragFrom(
        { x: 10, y: 20 },
        { x: 10 + direction * 200, y: 20 + direction * 100 },
        { shiftKey: true },
      );

      const drawn = (await editor.outlineBounds())!;
      expect(Bounds.width(drawn)).toBeCloseTo(200);
      expect(Bounds.height(drawn)).toBeCloseTo(200);
    },
  );

  it("selects the shape while dragging and hides its handles, and Escape drops both", async () => {
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 100, y: 60 });
    const [draft] = editor.drawnOutline();
    expect(editor.toolState()).toEqual({ id: "shape", state: "dragging" });
    expect(editor.selectionIds()).toEqual([draft?.id]);
    expect(editor.drawnHandles()).toEqual([]);

    await editor.pressKey("Escape");
    expect(editor.toolState()).toEqual({ id: "shape", state: "ready" });
    expect(editor.drawnOutline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);
  });

  it("grows with the drag and keeps the same contour, with its handles shown, on release", async () => {
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 100, y: 60 });
    const [draft] = editor.drawnOutline();
    const draftWidth = Bounds.width(Bounds.fromPoints(draft!.points)!);
    expect(draftWidth).toBeGreaterThan(0);

    editor.movePointerTo({ x: 200, y: 90 });
    const [grown] = editor.drawnOutline();
    expect(Bounds.width(Bounds.fromPoints(grown!.points)!)).toBeGreaterThan(draftWidth);

    await editor.releaseAt({ x: 200, y: 90 });
    const [committed] = await editor.outline();
    expect(committed).toEqual(grown);
    expect(committed).toMatchObject({ id: draft!.id });
    expect(editor.drawnHandles()).toMatchObject(
      committed!.points.map(({ id }) => ({ pointId: id })),
    );
  });

  it("squares the shape up when Shift goes down without the pointer moving", async () => {
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 110, y: 60 });
    const loose = Bounds.fromPoints(editor.drawnOutline()[0]!.points)!;
    expect(Bounds.width(loose)).not.toBeCloseTo(Bounds.height(loose));

    await editor.pressKey("Shift", { shiftKey: true });

    const constrained = Bounds.fromPoints(editor.drawnOutline()[0]!.points)!;
    expect(Bounds.width(constrained)).toBeCloseTo(Bounds.height(constrained));
    await editor.pressKey("Escape");
  });

  it("leaves other contours and their handles showing, and puts the selection back on cancel", async () => {
    await editor.dragFrom({ x: 0, y: 0 }, { x: 100, y: 100 });
    const selection = editor.selectionIds();
    const [original] = await editor.outline();

    editor.selectTool("shape");
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 100, y: 60 });
    expect(editor.drawnOutline()).toHaveLength(2);
    expect(editor.drawnHandles()).toMatchObject(
      original!.points.map(({ id }) => ({ pointId: id })),
    );

    await editor.pressKey("Escape");
    expect(await editor.outline()).toEqual([original]);
    expect(editor.selectionIds()).toEqual(selection);
  });

  it("drops the shape being dragged when another tool is chosen", () => {
    editor.holdDragFrom({ x: 10, y: 10 }, { x: 100, y: 60 });

    editor.selectTool("select");

    expect(editor.drawnOutline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);
  });

  it("adds nothing when the drag ends under three units wide", async () => {
    await editor.dragFrom({ x: 10, y: 20 }, { x: 12, y: 100 });

    expect(await editor.outline()).toEqual([]);
    expect(editor.toolState()).toEqual({ id: "shape", state: "ready" });
  });

  it("undoes and redoes the whole shape and its selection in one step", async () => {
    await editor.dragFrom({ x: 10, y: 20 }, { x: 210, y: 120 });
    const after = await editor.outline();
    const selection = editor.selectionIds();

    await editor.undo();
    expect(await editor.outline()).toEqual([]);
    expect(editor.selectionIds()).toEqual([]);

    await editor.redo();
    expect(await editor.outline()).toEqual(after);
    expect(editor.selectionIds()).toEqual(selection);
  });
});
