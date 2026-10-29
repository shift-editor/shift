import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { line } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();
let first: PointId;
let second: PointId;
beforeEach(async () => {
  ({ first, second } = await editor.draw({
    contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })],
  }));
  editor.selectTool("select");
});

describe("selection changes share the undo timeline with edits", () => {
  it("leaves the document untouched when a selection is undone and redone", async () => {
    const before = await editor.documentState();

    await editor.clickAt({ x: 100, y: 100 });
    await editor.undo();
    await editor.redo();

    expect(await editor.documentState()).toEqual(before);
    expect(editor.selectionIds()).toEqual([first]);
  });

  it("undoes a Shift-click on its own", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });
    expect(editor.selectionIds()).toEqual([first, second]);

    await editor.undo();
    expect(editor.selectionIds()).toEqual([first]);

    await editor.redo();
    expect(editor.selectionIds()).toEqual([first, second]);
  });

  it("undoes a marquee as one selection step", async () => {
    await editor.dragFrom({ x: 80, y: 80 }, { x: 130, y: 130 });
    expect(editor.selectionIds()).toEqual([first]);

    await editor.undo();
    expect(editor.selectionIds()).toEqual([]);

    await editor.redo();
    expect(editor.selectionIds()).toEqual([first]);
  });

  it("adds to the starting selection with a Shift-marquee", async () => {
    editor.select([second]);

    await editor.dragFrom({ x: 60, y: 60 }, { x: 130, y: 130 }, { shiftKey: true });
    expect(editor.selectionIds()).toEqual([second, first]);

    await editor.undo();
    expect(editor.selectionIds()).toEqual([second]);
  });

  it("keeps the selection when a Shift-marquee takes in no points", async () => {
    editor.select([second]);

    await editor.dragFrom({ x: 60, y: 60 }, { x: 80, y: 80 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([second]);
  });

  it("drops only the points a shrinking Shift-marquee had taken in", async () => {
    editor.select([second]);

    editor.pressAt({ x: 60, y: 60 }, { shiftKey: true });
    editor.movePointerTo({ x: 130, y: 130 }, { shiftKey: true });
    expect(editor.selectionIds()).toEqual([second, first]);
    editor.movePointerTo({ x: 80, y: 80 }, { shiftKey: true });
    await editor.releaseAt({ x: 80, y: 80 }, { shiftKey: true });

    expect(editor.selectionIds()).toEqual([second]);
  });

  it("restores the starting selection when a marquee is abandoned", () => {
    editor.select([second]);

    editor.pressAt({ x: 60, y: 60 }, { shiftKey: true });
    editor.movePointerTo({ x: 130, y: 130 }, { shiftKey: true });
    expect(editor.selectionIds()).toEqual([second, first]);

    editor.cancelGesture();
    expect(editor.selectionIds()).toEqual([second]);
  });

  it("undoes Escape's deselection on its own", async () => {
    editor.select([first]);

    await editor.pressKey("Escape");
    expect(editor.selectionIds()).toEqual([]);

    await editor.undo();
    expect(editor.selectionIds()).toEqual([first]);
  });

  it("waits for a pending edit before undoing it", async () => {
    editor.selectTool("pen");
    editor.pressAt({ x: 300, y: 300 });
    const released = editor.releaseAt({ x: 300, y: 300 });

    await editor.undo();
    await released;

    expect(await editor.outline()).toMatchObject([{ points: [{ id: first }, { id: second }] }]);
  });

  it("undoes selecting and moving an unselected point together", async () => {
    await editor.dragPoint(first, { x: 40, y: 30 });
    expect(editor.selectionIds()).toEqual([first]);
    expect(await editor.point(first)).toMatchObject({ x: 140, y: 130 });

    await editor.undo();
    expect(editor.selectionIds()).toEqual([]);
    expect(await editor.point(first)).toMatchObject({ x: 100, y: 100 });

    await editor.redo();
    expect(editor.selectionIds()).toEqual([first]);
    expect(await editor.point(first)).toMatchObject({ x: 140, y: 130 });
  });

  it("undoes a deletion together with the selection it cleared", async () => {
    editor.select([second]);

    await editor.deleteSelection();
    expect(await editor.point(second)).toBeNull();
    expect(editor.selectionIds()).toEqual([]);

    await editor.undo();
    expect(await editor.point(second)).not.toBeNull();
    expect(editor.selectionIds()).toEqual([second]);

    await editor.redo();
    expect(await editor.point(second)).toBeNull();
    expect(editor.selectionIds()).toEqual([]);
  });

  it("discards a selection's redo after a new selection", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    await editor.clickAt({ x: 200, y: 200 }, { shiftKey: true });
    await editor.undo();

    await editor.clickAt({ x: 5000, y: 5000 });
    await editor.redo();

    expect(editor.selectionIds()).toEqual([]);
  });

  it("discards an edit's redo after a new selection", async () => {
    editor.selectTool("pen");
    await editor.clickAt({ x: 300, y: 300 });
    await editor.undo();
    expect(await editor.outline()).toMatchObject([{ points: [{ id: first }, { id: second }] }]);

    editor.selectTool("select");
    await editor.clickAt({ x: 100, y: 100 });
    await editor.redo();

    expect(await editor.outline()).toMatchObject([{ points: [{ id: first }, { id: second }] }]);
    expect(editor.selectionIds()).toEqual([first]);
  });
});
