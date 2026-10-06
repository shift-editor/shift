import { beforeEach, describe, expect, it } from "vitest";
import { setGlyphMetric, sidebarGlyphs } from "@shift/editor/ui";
import { glyphTextItem } from "@shift/editor/text";
import { TestEditor } from "@/testing/TestEditor";

describe("the glyph sidebar targets what you are working on", () => {
  let editor: TestEditor;

  const names = () => sidebarGlyphs(editor).map((glyph) => glyph.name);
  const advance = (name: string) => {
    const glyphId = editor.font.entryForName(name)!.id;
    return editor.layerForGlyph(glyphId, editor.activeSourceId!)?.xAdvance;
  };

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("B", 66);
  });

  it("targets the entered glyph outside Text mode", () => {
    expect(names()).toEqual(["A"]);
  });

  it("targets the glyph at the caret in Text mode, not the glyph edited before", () => {
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("B", 66)]);
    expect(names()).toEqual(["B"]);
    const before = advance("A");

    setGlyphMetric(editor, sidebarGlyphs(editor), "advance", 777);

    expect(advance("B")).toBe(777);
    expect(advance("A")).toBe(before);
  });

  it("edits every selected glyph in Text mode as one undo step", async () => {
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("B", 66)]);
    editor.textEditing.move(-1, "character", true);
    editor.textEditing.move(-1, "character", true);
    expect(names()).toEqual(["A", "B"]);
    const before = { A: advance("A"), B: advance("B") };

    setGlyphMetric(editor, sidebarGlyphs(editor), "advance", 640);
    expect({ A: advance("A"), B: advance("B") }).toEqual({ A: 640, B: 640 });

    await editor.undo();
    expect({ A: advance("A"), B: advance("B") }).toEqual(before);
  });
});
