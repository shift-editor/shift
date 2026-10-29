import { describe, expect, it } from "vitest";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

const corner = rect(0, 0, 100, 100, { bottomLeft: "corner" });

describe("undoing and redoing edits", () => {
  it("undoes edits one at a time, newest first", async () => {
    const { corner: id } = await editor.draw({ contours: [corner] });
    await editor.dragPoint(id, { x: 10, y: 0 });
    await editor.dragPoint(id, { x: 0, y: 20 });

    await editor.undo();
    expect(await editor.point(id)).toMatchObject({ x: 10, y: 0 });

    await editor.undo();
    expect(await editor.point(id)).toMatchObject({ x: 0, y: 0 });
  });

  it("redoes undone edits in the order they were made", async () => {
    const { corner: id } = await editor.draw({ contours: [corner] });
    await editor.dragPoint(id, { x: 10, y: 0 });
    await editor.dragPoint(id, { x: 0, y: 20 });
    await editor.undo();
    await editor.undo();

    await editor.redo();
    expect(await editor.point(id)).toMatchObject({ x: 10, y: 0 });

    await editor.redo();
    expect(await editor.point(id)).toMatchObject({ x: 10, y: 20 });
  });

  it("drops the undone edits once a new edit is made", async () => {
    const { corner: id } = await editor.draw({ contours: [corner] });
    await editor.dragPoint(id, { x: 10, y: 0 });
    await editor.dragPoint(id, { x: 0, y: 20 });
    await editor.undo();

    await editor.dragPoint(id, { x: 30, y: 40 });
    await editor.redo();

    expect(await editor.point(id)).toMatchObject({ x: 40, y: 40 });
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
