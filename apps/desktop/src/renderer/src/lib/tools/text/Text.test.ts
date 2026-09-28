import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Text tool", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("text");
  });

  it("publishes typing until Escape returns to Select", () => {
    expect(editor.toolIf("text")?.state).toEqual({ type: "typing" });
    expect(editor.cursor).toBe("text");

    editor.escape();

    expect(editor.toolIf("text")).toBeNull();
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });
});

describe("typing a glyph not yet loaded this session", () => {
  const outputRoots: string[] = [];

  afterEach(() => {
    for (const root of outputRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** Saves a font whose `B` glyph advances 600, then reopens it on `A` without loading `B`. */
  async function reopenedWithUnloadedB(): Promise<TestEditor> {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-unloaded-text-glyph-"));
    outputRoots.push(outputRoot);
    const savePath = join(outputRoot, "Text.shift");

    const setup = new TestEditor();
    await setup.startSession("A", 65);
    await setup.addGlyph("B", 66);
    const bRecord = setup.font.recordForName("B" as GlyphName)!;
    const b = await setup.font.loadGlyph(bRecord.id);
    b.layerForSource(setup.font.defaultSource.id)!.setXAdvance(600);
    await setup.saveAs(savePath);
    await setup.closeSession();

    const editor = new TestEditor();
    await editor.openSession(savePath, "A");
    return editor;
  }

  it("lays the glyph out at its advance once its model loads", async () => {
    const editor = await reopenedWithUnloadedB();
    const bId = editor.font.recordForName("B" as GlyphName)!.id;
    expect(editor.glyphForId(bId)).toBeNull();

    editor.insertTextCodepoint(66);
    expect(editor.textRun.layoutCell.peek()?.totalAdvance).toBe(0);

    await editor.font.loadGlyph(bId);

    expect(editor.textRun.layoutCell.peek()?.totalAdvance).toBe(600);
  });
});
