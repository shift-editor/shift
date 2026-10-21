import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import type { GlyphName, RunId } from "@shift/types";
import {
  defaultExternalAxisLocation,
  externalAxisLocationFromRecord,
  withExternalAxisValue,
} from "@shift/editor/variation";

describe("placed text layout follows font location", () => {
  it("interpolates a run's advance between authored masters", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    const glyph = editor.glyphForId(editor.glyphRecord!.id)!;
    editor.requireGlyphLayer().setXAdvance(300);
    await editor.settle();

    const axisId = editor.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await editor.settle();
    const sourceId = editor.createSource("Bold", externalAxisLocationFromRecord({ [axisId]: 700 }));
    await editor.settle();
    glyph.layerForSource(sourceId)!.setXAdvance(500);
    await editor.settle();
    editor.setSourceToDefault();

    const run = editor.text.createRun([editor.text.glyphItem(glyph.id)!]);
    expect(editor.text.layoutCell(run.id).peek()?.totalAdvance).toBeCloseTo(300);

    const midpoint = withExternalAxisValue(
      defaultExternalAxisLocation(editor.font.getAxes()),
      editor.font.getAxes()[0]!,
      550,
    );
    editor.setExternalLocation(midpoint);
    expect(editor.text.layoutCell(run.id).peek()?.totalAdvance).toBeCloseTo(400);
  });
});

describe("text items resolve to glyphs", () => {
  const glyphIds = (editor: TestEditor, runId: RunId) =>
    editor.text
      .layoutCell(runId)
      .peek()!
      .placedGlyphs.map((placed) => placed.glyph.glyphId);

  it("shows a character through the font's Unicode mapping and follows a remap", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("B", 66);
    const b = editor.font.recordForName("B" as GlyphName)!;
    const run = editor.text.createRun(editor.text.itemsFromText("B"));
    await editor.settle();
    expect(glyphIds(editor, run.id)).toEqual([b.id]);

    editor.font.updateGlyphIdentity(b.id, "B" as GlyphName, []);
    await editor.settle();

    expect(glyphIds(editor, run.id)).toEqual([null]);
  });

  it("keeps a glyph with no Unicode value by identity, through a rename", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("a.alt", null);
    const alt = editor.font.recordForName("a.alt" as GlyphName)!;
    const run = editor.text.createRun(editor.text.itemsFromText("/a.alt"));
    expect(run.items).toMatchObject([{ kind: "glyph", glyphId: alt.id }]);

    editor.font.updateGlyphIdentity(alt.id, "a.ss01" as GlyphName, []);
    await editor.settle();

    expect(glyphIds(editor, run.id)).toEqual([alt.id]);
  });

  it("reads a slash before a name the font lacks as literal text", async () => {
    const editor = new TestEditor();
    await editor.startSession();

    const items = editor.text.itemsFromText("/nope");

    expect(items.map((item) => item.kind === "character" && item.codepoint)).toEqual(
      [..."/nope"].map((char) => char.codePointAt(0)),
    );
  });
});
