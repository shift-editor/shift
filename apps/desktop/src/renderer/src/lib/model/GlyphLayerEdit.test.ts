import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("glyph layer edits preserve committed preview bases", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(300, 200);
  });

  it("previews, finishes, and undoes through the workspace ledger", async () => {
    const layer = editor.requireGlyphLayer();
    const pointId = layer.allPoints[0]!.id;
    const edit = layer.beginEdit();

    edit.setPositions([{ kind: "point", id: pointId, x: 125, y: 90 }]);
    expect(editor.pointPosition(pointId)).toEqual({ x: 125, y: 90 });

    edit.finish("Move point");
    await editor.settle();
    expect(editor.pointPosition(pointId)).toEqual({ x: 125, y: 90 });

    await editor.undo();
    expect(editor.pointPosition(pointId)).toEqual({ x: 100, y: 100 });
  });

  it("cancels every previewed position in an arbitrary patch", () => {
    const layer = editor.requireGlyphLayer();
    const [first, second] = layer.allPoints;
    const edit = layer.beginEdit();

    edit.setPositions([
      { kind: "point", id: first!.id, x: 110, y: 100 },
      { kind: "point", id: second!.id, x: 320, y: 200 },
    ]);
    edit.cancel();

    expect(editor.pointPosition(first!.id)).toEqual({ x: 100, y: 100 });
    expect(editor.pointPosition(second!.id)).toEqual({ x: 300, y: 200 });
  });

  it("uses every position in a finished patch as the next cancellation base", async () => {
    const layer = editor.requireGlyphLayer();
    const [first, second] = layer.allPoints;
    const firstEdit = layer.beginEdit();
    firstEdit.setPositions([
      { kind: "point", id: first!.id, x: 110, y: 100 },
      { kind: "point", id: second!.id, x: 320, y: 200 },
    ]);
    firstEdit.finish("Expanded move");
    await editor.settle();

    const secondEdit = layer.beginEdit();
    secondEdit.setPositions([
      { kind: "point", id: first!.id, x: 130, y: 100 },
      { kind: "point", id: second!.id, x: 340, y: 200 },
    ]);
    secondEdit.cancel();

    expect([editor.pointPosition(first!.id), editor.pointPosition(second!.id)]).toEqual([
      { x: 110, y: 100 },
      { x: 320, y: 200 },
    ]);
  });
});
