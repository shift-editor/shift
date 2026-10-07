import { beforeEach, describe, expect, it } from "vitest";
import { glyphTextItem } from "@shift/editor/text";
import { TestEditor } from "@/testing/TestEditor";

describe("the inspector describes the active tool's subject", () => {
  let editor: TestEditor;

  const names = () => editor.glyphMetrics()?.glyphs.map((glyph) => glyph.name) ?? [];
  const advance = (name: string) => {
    const glyphId = editor.font.entryForName(name)!.id;
    return editor.layerForGlyph(glyphId, editor.activeSourceId!)?.xAdvance;
  };

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("B", 66);
  });

  it("describes the entered glyph, also while its points are selected", async () => {
    expect(names()).toEqual(["A"]);

    const [pointId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    editor.selection.select([pointId!]);

    expect(names()).toEqual(["A"]);
  });

  it("describes the glyph at the caret in Text mode, not the glyph edited before", () => {
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("B", 66)]);
    expect(names()).toEqual(["B"]);
    const before = advance("A");

    editor.glyphMetrics()!.set("advance", 777);

    expect(advance("B")).toBe(777);
    expect(advance("A")).toBe(before);
  });

  it("edits every glyph in a Text mode range as one undo step", async () => {
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("B", 66)]);
    editor.textEditing.move(-1, "character", true);
    editor.textEditing.move(-1, "character", true);
    expect(names()).toEqual(["A", "B"]);
    const before = { A: advance("A"), B: advance("B") };

    editor.glyphMetrics()!.set("advance", 640);
    expect({ A: advance("A"), B: advance("B") }).toEqual({ A: 640, B: 640 });

    await editor.undo();
    expect({ A: advance("A"), B: advance("B") }).toEqual(before);
  });

  it("describes the selected run glyphs at run level", () => {
    editor.selectTool("text");
    editor.textEditing.insert([glyphTextItem("B", 66)]);
    editor.selectTool("select");
    editor.exitNodes();

    editor.selection.select(editor.text.glyphItems().map((item) => item.id));

    expect(names()).toEqual(["A", "B"]);
  });
});
