import { beforeEach, describe, expect, it } from "vitest";
import type { Editor } from "@shift/editor";
import { mintGlyphId, type GlyphName, type PointId, type Unicode } from "@shift/types";
import { line } from "@/testing/fixtures";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

/** Selects `pointId` and creates two glyphs, all captured by one history action. */
function createGlyphsInOneAction(editor: Editor, pointId: PointId): void {
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- EditorHistory is the subject: one capture spanning several workspace edits, which only the desktop workspace replays
  const capture = editor.history.begin("Create glyphs");
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- selection inside the history capture under test
  editor.selection.select([pointId]);
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- a workspace edit inside the history capture under test
  editor.createGlyph("B" as GlyphName);
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- a workspace edit inside the history capture under test
  editor.createGlyph("C" as GlyphName);
  capture.finish();
}

/**
 * Selects `pointId` and sends the workspace an edit, captured by one history
 * action. Returns the edit's outcome.
 */
function selectAndApplyInOneAction(editor: Editor, pointId: PointId): Promise<unknown> {
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- EditorHistory is the subject: a capture whose workspace edit the desktop workspace refuses
  const capture = editor.history.begin("Rejected edit");
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- selection inside the history capture under test
  editor.selection.select([pointId]);
  // oxlint-disable-next-line shift/no-editor-internals-in-tests -- the workspace edit the capture under test sends, which failNextWorkspaceApply refuses
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
  capture.finish();
  return applying;
}

describe("EditorHistory", () => {
  let editor: EditorTestSurface;
  let firstId: PointId;
  let secondId: PointId;

  beforeEach(async () => {
    editor = await startTestEditor();
    ({ first: firstId, second: secondId } = await editor.draw({
      contours: [line({ x: 100, y: 100, name: "first" }, { x: 200, y: 200, name: "second" })],
    }));
    editor.selectTool("select");
    editor.select([]);
  });

  it("replays multiple workspace operations captured by one action", async () => {
    createGlyphsInOneAction(editor.asEditor(), firstId);
    await editor.settle();
    expect(editor.glyphNamed("B")).not.toBeNull();
    expect(editor.glyphNamed("C")).not.toBeNull();

    await editor.undo();
    expect(editor.glyphNamed("B")).toBeNull();
    expect(editor.glyphNamed("C")).toBeNull();
    expect(editor.selectionIds()).toEqual([]);

    await editor.redo();
    expect(editor.glyphNamed("B")).not.toBeNull();
    expect(editor.glyphNamed("C")).not.toBeNull();
    expect(editor.selectionIds()).toEqual([firstId]);
  });

  it("rebases a later selection when an earlier workspace action fails", async () => {
    editor.failNextWorkspaceApply();
    const rejected = expect(
      selectAndApplyInOneAction(editor.asEditor(), firstId),
    ).rejects.toThrow();

    await editor.clickAt({ x: 200, y: 200 });
    await rejected;
    expect(editor.selectionIds()).toEqual([secondId]);

    await editor.undo();
    expect(editor.selectionIds()).toEqual([]);
  });
});
