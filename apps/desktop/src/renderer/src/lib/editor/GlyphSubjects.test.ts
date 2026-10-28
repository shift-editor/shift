import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import type { GlyphNode } from "@shift/editor/types";
import { effect } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";
import { FONTS } from "@/testing/fontFixture";

let editor: TestEditor;
let a: GlyphNode;

beforeEach(async () => {
  editor = await new TestEditor().openSession(FONTS.mutatorSansLightCondensed, "A");
  a = editor.scene.only("glyph")!;
});

afterEach(async () => {
  await editor.close();
});

/** Places glyph `name` on the canvas beside the open glyph, as a second glyph node. */
async function placeGlyph(name: string): Promise<GlyphNode> {
  const record = editor.font.recordForName(name as GlyphName)!;
  await editor.font.loadGlyph(record.id);
  const { id } = editor.scene.createNode<GlyphNode>({
    kind: "glyph",
    glyphId: record.id,
    sourceId: editor.font.defaultSource.id,
    position: { x: 800, y: 0 },
  });
  return editor.scene.nodeOfKind(id, "glyph")!;
}

describe("glyph subjects with one glyph open", () => {
  it("are the open glyph, which is the sole subject", () => {
    expect(editor.subjectGlyphNodesCell.peek()).toEqual([a]);
    expect(editor.subjectGlyphIdsCell.peek()).toEqual([
      editor.font.recordForName("A" as GlyphName)!.id,
    ]);
    expect(editor.soleSubjectGlyphNode()).toBe(a);
  });

  it("stay the open glyph while Text mode leaves it", () => {
    editor.selectTool("text");

    expect(editor.editing.nodeIds).toEqual([]);
    expect(editor.soleSubjectGlyphNode()).toBe(a);
  });
});

describe("glyph subjects with two glyphs on the canvas", () => {
  it("are the edited glyph when only one is edited", async () => {
    await placeGlyph("B");

    expect(editor.subjectGlyphNodesCell.peek()).toEqual([a]);
    expect(editor.soleSubjectGlyphNode()).toBe(a);
  });

  it("are both edited glyphs, with no sole subject", async () => {
    const b = await placeGlyph("B");
    editor.editing.set([a.id, b.id]);

    expect(editor.subjectGlyphNodesCell.peek()).toEqual([a, b]);
    expect(editor.subjectGlyphIdsCell.peek()).toEqual([a.glyphId, b.glyphId]);
    expect(editor.soleSubjectGlyphNode()).toBeNull();
  });

  it("narrow to the glyph the selection belongs to", async () => {
    const b = await placeGlyph("B");
    editor.editing.set([a.id, b.id]);
    const point = editor.layerOf(b, b.sourceId)!.allPoints[0]!;

    editor.selection.select([point.id]);

    expect(editor.subjectGlyphNodesCell.peek()).toEqual([b]);
    expect(editor.soleSubjectGlyphNode()).toBe(b);
  });

  it("follow the selection for a reader subscribed before it changes", async () => {
    const b = await placeGlyph("B");
    editor.editing.set([a.id, b.id]);
    const seen: (string | null)[] = [];
    const reader = effect(() => {
      seen.push(editor.soleSubjectGlyphNodeCell.value?.id ?? null);
    });

    editor.selection.select([editor.layerOf(a, a.sourceId)!.allPoints[0]!.id]);
    reader.dispose();

    expect(seen).toEqual([null, a.id]);
  });

  it("are every glyph on the canvas when none is edited", async () => {
    const b = await placeGlyph("B");
    editor.selectTool("text");

    expect(editor.subjectGlyphNodesCell.peek()).toEqual([a, b]);
    expect(editor.soleSubjectGlyphNode()).toBeNull();
  });
});

describe("what a glyph node shows", () => {
  it("is its glyph, and that glyph's layer at a source", async () => {
    const b = await placeGlyph("B");
    const glyphB = editor.font.recordForName("B" as GlyphName)!.id;
    const source = editor.font.defaultSource.id;

    expect(editor.glyphIdOf(b)).toBe(glyphB);
    expect(editor.glyphOf(b)?.id).toBe(glyphB);
    expect(editor.layerOf(b, source)).toBe(editor.layerForGlyph(glyphB, source));
  });

  it("is drawn from its own render model", async () => {
    const b = await placeGlyph("B");
    const glyphs = editor.nodeDefinition("glyph");

    expect(glyphs.renderModel(b)?.xAdvance).toBe(editor.layerOf(b, b.sourceId)!.xAdvance);
    expect(glyphs.renderModel(a)?.xAdvance).toBe(editor.layerOf(a, a.sourceId)!.xAdvance);
  });
});
