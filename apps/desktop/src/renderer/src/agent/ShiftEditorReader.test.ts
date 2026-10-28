import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import type { GlyphNode } from "@shift/editor/types";
import { TestEditor } from "@/testing/TestEditor";
import { FONTS } from "@/testing/fontFixture";

let editor: TestEditor;

afterEach(async () => {
  await editor.close();
});

describe("the editor's glyphs, with two on the canvas", () => {
  let a: GlyphNode;
  let b: GlyphNode;

  beforeEach(async () => {
    editor = await new TestEditor().openSession(FONTS.mutatorSansLightCondensed, "A");
    a = editor.scene.only("glyph")!;
    const record = editor.font.recordForName("B" as GlyphName)!;
    await editor.font.loadGlyph(record.id);
    const { id } = editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      glyphId: record.id,
      sourceId: editor.font.defaultSource.id,
      position: { x: 800, y: 0 },
    });
    b = editor.scene.nodeOfKind(id, "glyph")!;
  });

  it("lists the edited glyph, and both once both are edited", () => {
    expect(editor.editorView().glyphs).toEqual([
      expect.objectContaining({ name: "A", nodeId: a.id, edited: true }),
    ]);

    editor.editing.set([a.id, b.id]);

    expect(editor.editorView().glyphs).toEqual([
      expect.objectContaining({ name: "A", nodeId: a.id, edited: true }),
      expect.objectContaining({ name: "B", nodeId: b.id, edited: true }),
    ]);
  });

  it("lists every placed glyph, not edited, while Text mode leaves them", () => {
    editor.selectTool("text");

    expect(editor.editorView().glyphs.map(({ name, edited }) => ({ name, edited }))).toEqual([
      { name: "A", edited: false },
      { name: "B", edited: false },
    ]);
  });

  it("reads the glyph a read names, and refuses to guess between two edited glyphs", async () => {
    editor.editing.set([a.id, b.id]);
    const layerB = editor.layerOf(b, b.sourceId)!;

    expect(await editor.advanceWidth({ glyph: "B" })).toBe(layerB.xAdvance);
    expect((await editor.outline({ glyph: "B" })).map(({ id }) => id)).toEqual(
      layerB.contours.map(({ id }) => id),
    );
    expect(editor.drawnOutline({ glyph: "B" }).map(({ id }) => id)).toEqual(
      layerB.contours.map(({ id }) => id),
    );
    await expect(editor.outline()).rejects.toThrow(/pass \{ glyph \}/);
  });
});

describe("the glyph as the canvas draws it", () => {
  it("shows a held drag before release, with the authored point ids", async () => {
    editor = await new TestEditor().openSession(FONTS.mutatorSansLightCondensed, "A");
    const [contour] = await editor.outline();
    const point = contour!.points[0]!;

    editor.holdDrag(point.id, { x: 40, y: 0 });

    const [drawn] = editor.drawnOutline();
    expect(drawn!.points.map(({ id }) => id)).toEqual(contour!.points.map(({ id }) => id));
    expect(drawn!.points[0]).toMatchObject({ id: point.id, x: point.x + 40, y: point.y });
  });

  it("interpolates between sources, as the canvas draws it there", async () => {
    editor = await new TestEditor().openSession(FONTS.mutatorSans, "A");
    const thin = await editor.layerAt("LightCondensed");
    const bold = await editor.layerAt("BoldCondensed");

    editor.setLocation({ wght: 500, wdth: 0 });

    const [drawn] = editor.drawnOutline();
    const [thinFirst, boldFirst] = [thin.contours[0]!.points[0]!, bold.contours[0]!.points[0]!];
    expect(drawn!.points[0]!.x).toBeGreaterThan(Math.min(thinFirst.x, boldFirst.x));
    expect(drawn!.points[0]!.x).toBeLessThan(Math.max(thinFirst.x, boldFirst.x));
  });
});
