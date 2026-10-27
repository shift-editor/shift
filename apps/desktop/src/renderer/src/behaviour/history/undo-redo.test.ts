import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
});
afterEach(() => editor.close());

const corner = {
  closed: true,
  points: [{ x: 0, y: 0, name: "corner" }, [100, 0], [100, 100], [0, 100]],
} as const;

describe("undoing and redoing edits", () => {
  it("undoes edits one at a time, newest first", async () => {
    const { corner: id } = await editor.draw({ contours: [corner] });
    await editor.dragPoint(id, { x: 10, y: 0 });
    await editor.dragPoint(id, { x: 0, y: 20 });

    await editor.undo();
    expect(await editor.pointPositions([id])).toEqual({ [id]: { x: 10, y: 0 } });

    await editor.undo();
    expect(await editor.pointPositions([id])).toEqual({ [id]: { x: 0, y: 0 } });
  });

  it("redoes undone edits in the order they were made", async () => {
    const { corner: id } = await editor.draw({ contours: [corner] });
    await editor.dragPoint(id, { x: 10, y: 0 });
    await editor.dragPoint(id, { x: 0, y: 20 });
    await editor.undo();
    await editor.undo();

    await editor.redo();
    expect(await editor.pointPositions([id])).toEqual({ [id]: { x: 10, y: 0 } });

    await editor.redo();
    expect(await editor.pointPositions([id])).toEqual({ [id]: { x: 10, y: 20 } });
  });

  it("drops the undone edits once a new edit is made", async () => {
    const { corner: id } = await editor.draw({ contours: [corner] });
    await editor.dragPoint(id, { x: 10, y: 0 });
    await editor.dragPoint(id, { x: 0, y: 20 });
    await editor.undo();

    await editor.dragPoint(id, { x: 30, y: 40 });
    await editor.redo();

    expect(await editor.pointPositions([id])).toEqual({ [id]: { x: 40, y: 40 } });
  });

  it("undoes the glyph's creation, then does nothing with no edits left", async () => {
    expect(editor.fontOverview().glyphCount).toBe(1);

    await editor.undo();
    expect(editor.fontOverview().glyphCount).toBe(0);

    await editor.undo();
    expect(editor.fontOverview().glyphCount).toBe(0);

    await editor.redo();
    expect(editor.fontOverview().glyphCount).toBe(1);
  });
});
