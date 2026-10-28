import { beforeEach, describe, expect, it } from "vitest";
import { cursorToCSS } from "@shift/editor/rendering";
import { onCurve } from "@/testing/outlineMatchers";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("panning the canvas with the Hand", () => {
  beforeEach(() => {
    editor.selectTool("hand");
  });

  it("is ready when chosen and hands over to the next tool chosen", () => {
    expect(editor.toolState()).toEqual({ id: "hand", state: "ready" });

    editor.selectTool("select");

    expect(editor.toolState()).toEqual({ id: "select", state: "ready" });
  });

  it("closes the hand on press, before any drag, and opens it on release", async () => {
    expect(editor.shownCursor()).toBe("grab");

    editor.holdDragFrom({ x: 0, y: 0 }, { x: 0, y: 0 });
    expect(editor.shownCursor()).toBe("grabbing");

    await editor.releaseAt({ x: 0, y: 0 });
    expect(editor.shownCursor()).toBe("grab");
    expect(editor.toolState()).toEqual({ id: "hand", state: "ready" });
  });

  it("moves the canvas with the pointer", async () => {
    const start = editor.canvasOffset();

    // At zoom 1 a font unit is a screen pixel; screen y runs down.
    await editor.dragFrom({ x: 0, y: 0 }, { x: 120, y: -80 });

    expect(editor.canvasOffset()).toEqual({ x: start.x + 120, y: start.y + 80 });
  });

  it("stops panning when Escape cancels the drag", async () => {
    editor.holdDragFrom({ x: 0, y: 0 }, { x: 100, y: 0 });
    const panned = editor.canvasOffset();

    await editor.pressKey("Escape");
    expect(editor.toolState()).toEqual({ id: "hand", state: "ready" });
    expect(editor.shownCursor()).toBe("grab");

    editor.movePointerTo({ x: 200, y: 0 });
    expect(editor.canvasOffset()).toEqual(panned);
  });

  it("does not pan on hover", () => {
    const start = editor.canvasOffset();

    editor.movePointerTo({ x: 50, y: 50 });
    editor.movePointerTo({ x: 100, y: 100 });

    expect(editor.canvasOffset()).toEqual(start);
  });
});

describe("panning with Space while another tool is active", () => {
  it("pans with the Hand while Space is held, then carries on drawing with the Pen", async () => {
    editor.selectTool("pen");
    const penCursor = editor.shownCursor();
    const start = editor.canvasOffset();

    editor.holdSpaceForHand();
    await editor.dragFrom({ x: 0, y: 0 }, { x: 120, y: -80 });
    editor.releaseSpace();

    expect(editor.canvasOffset()).toEqual({ x: start.x + 120, y: start.y + 80 });
    expect(editor.shownCursor()).toBe(penCursor);
    expect(editor.toolState()?.id).toBe("pen");

    await editor.clickAt({ x: 100, y: 100 });
    expect(await editor.outline()).toMatchObject([{ points: [onCurve(100, 100)] }]);
  });

  it("keeps the Pen, not the Select tool, while Cmd is held", async () => {
    editor.selectTool("pen");
    const penCursor = editor.shownCursor();

    await editor.pressKey("Meta", { metaKey: true });

    expect(editor.shownCursor()).toBe(penCursor);
    expect(editor.shownCursor()).toBe(cursorToCSS({ type: "pen" }));
    expect(editor.toolState()?.id).toBe("pen");
  });
});
