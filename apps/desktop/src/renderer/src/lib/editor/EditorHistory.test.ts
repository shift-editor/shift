import { beforeEach, describe, expect, it } from "vitest";
import { mintGlyphId, type GlyphName, type PointId, type Unicode } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("EditorHistory", () => {
  let editor: TestEditor;
  let firstId: PointId;
  let secondId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    const pointIds = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    if (!pointIds[0] || !pointIds[1]) throw new Error("Expected two points");
    [firstId, secondId] = pointIds;
    editor.selectTool("select");
    editor.selection.clear();
  });

  it("replays multiple workspace operations captured by one action", async () => {
    const capture = editor.history.begin("Create glyphs");
    editor.selection.select([firstId]);
    editor.createGlyph("B" as GlyphName);
    editor.createGlyph("C" as GlyphName);
    capture.finish();
    await editor.settle();
    expect(editor.font.recordForName("B" as GlyphName)).not.toBeNull();
    expect(editor.font.recordForName("C" as GlyphName)).not.toBeNull();

    await editor.undo();
    expect(editor.font.recordForName("B" as GlyphName)).toBeNull();
    expect(editor.font.recordForName("C" as GlyphName)).toBeNull();
    expect(editor.selection.ids).toEqual([]);

    await editor.redo();
    expect(editor.font.recordForName("B" as GlyphName)).not.toBeNull();
    expect(editor.font.recordForName("C" as GlyphName)).not.toBeNull();
    expect(editor.selection.ids).toEqual([firstId]);
  });

  it("rebases a later selection when an earlier workspace action fails", async () => {
    const capture = editor.history.begin("Rejected edit");
    editor.selection.select([firstId]);
    editor.failNextWorkspaceApply();
    const applying = editor.font.editCoordinator.apply([
      {
        kind: "createGlyph",
        createGlyph: {
          glyphId: mintGlyphId(),
          name: "Z" as GlyphName,
          unicodes: [90 as Unicode],
        },
      },
    ]);
    const rejected = expect(applying).rejects.toThrow();
    capture.finish();

    await editor.clickLocal(200, 200);
    await rejected;
    expect(editor.selection.ids).toEqual([secondId]);

    await editor.undo();
    expect(editor.selection.ids).toEqual([]);
  });
});
