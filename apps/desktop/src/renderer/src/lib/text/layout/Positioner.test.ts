import { describe, it, expect, beforeEach } from "vitest";
import type { TestEditor } from "@/testing/TestEditor";
import { NONSPACING_MARK_EDITOR_ADVANCE, Positioner } from "@shift/editor/testing";
import { glyphTextItem as glyph } from "@shift/editor/text";
import { layoutTestEditor, ltrRun } from "./testUtils";
import { effect, signal } from "@shift/editor/signals";
import type { GlyphName } from "@shift/types";

describe("Positioner", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await layoutTestEditor();
  });

  // Levien invariant: positioned.advance === sum of xAdvance.
  it("advance equals sum of xAdvance", () => {
    const positioner = new Positioner();
    const run = ltrRun([glyph("A", 65), glyph("B", 66), glyph("C", 67)]);

    const positioned = positioner.position(run, editor, signal(editor.font.defaultLocation()));

    const sum = positioned.glyphs.reduce((s, g) => s + g.xAdvance, 0);
    expect(positioned.advance).toBe(sum);
    expect(positioned.advance).toBeGreaterThan(0);
  });

  // cluster numbering honors clusterStart and is monotonic.
  it("cluster equals clusterStart + i", () => {
    const positioner = new Positioner();
    const run = ltrRun([glyph("A", 65), glyph("B", 66)], /* clusterStart */ 7);

    const positioned = positioner.position(run, editor, signal(editor.font.defaultLocation()));

    expect(positioned.glyphs.map((g) => g.cluster)).toEqual([7, 8]);
  });

  // Each positioned glyph carries the bounds from its resolved render model.
  it("bounds pass through from the Glyph render model", () => {
    const positioner = new Positioner();
    const a = glyph("A", 65);
    const run = ltrRun([a]);
    const locationCell = signal(editor.font.defaultLocation());

    const positioned = positioner.position(run, editor, locationCell);
    const record = editor.font.recordForName("A");
    const expectedBounds = record
      ? (editor.glyphForId(record.id)?.renderModelAt(locationCell).bounds ?? null)
      : null;

    expect(positioned.glyphs[0].glyphId).toBe(record?.id);
    expect(positioned.glyphs[0].bounds).toEqual(expectedBounds);
    expect(positioned.glyphs[0].sourceItemIds).toEqual([a.id]);
    expect(positioned.glyphs[0].origin).toEqual({ x: 0, y: 0 });
  });

  // Glyph not in the font → zero advance, null bounds, no throw.
  it("handles missing glyph gracefully", () => {
    const positioner = new Positioner();
    const run = ltrRun([glyph("nonexistent-glyph-xyz", 65)]);

    const positioned = positioner.position(run, editor, signal(editor.font.defaultLocation()));

    expect(positioned.glyphs[0].xAdvance).toBe(0);
    expect(positioned.glyphs[0].bounds).toBeNull();
    expect(positioned.glyphs[0].glyphId).toBeNull();
  });

  describe("nonspacing marks follow the category export resolves", () => {
    async function addZeroWidthGlyph(name: string): Promise<void> {
      await editor.addGlyph(name, null);
      const record = editor.font.recordForName(name as GlyphName)!;
      editor.glyphForId(record.id)!.layerForSource(editor.font.defaultSource.id)!.setXAdvance(0);
      await editor.settle();
    }

    function positionedAfterA(name: string) {
      const run = ltrRun([glyph("A", 65), glyph(name, null)]);
      return new Positioner().position(run, editor, signal(editor.font.defaultLocation()))
        .glyphs[1]!;
    }

    // Glyph data reads `x.comb` as a suffixed `x`: a letter, though its name says `comb`.
    it("lays out a glyph named like a mark as spacing when its category is not a mark", async () => {
      await addZeroWidthGlyph("x.comb");

      const positioned = positionedAfterA("x.comb");

      expect(positioned.xAdvance).toBe(0);
      expect({ x: positioned.xOffset, y: positioned.yOffset }).toEqual({ x: 0, y: 0 });
    });

    // Glyph data reads `fatha-ar` as a nonspacing mark; neither name nor Unicode says so.
    it("gives a nonspacing mark a visible advance though its name does not look like one", async () => {
      await addZeroWidthGlyph("fatha-ar");

      expect(positionedAfterA("fatha-ar").xAdvance).toBe(NONSPACING_MARK_EDITOR_ADVANCE);
    });

    it("lays out a character with no glyph as spacing, then as a mark once the glyph exists", async () => {
      const run = editor.text.createRun([glyph("A", 65), glyph("fatha-ar", null)]);
      const layoutCell = editor.text.layoutCell(run.id);
      const advances: number[] = [];
      const subscription = effect(() => {
        advances.push(layoutCell.value!.placedGlyphs[1]!.glyph.xAdvance);
      });

      await addZeroWidthGlyph("fatha-ar");
      subscription.dispose();

      expect(advances[0]).toBe(0);
      expect(advances.at(-1)).toBe(NONSPACING_MARK_EDITOR_ADVANCE);
    });
  });

  // Empty run → empty positioned glyphs, zero advance.
  it("empty run yields empty positioned glyphs", () => {
    const positioner = new Positioner();
    const run = ltrRun([]);

    const positioned = positioner.position(run, editor, signal(editor.font.defaultLocation()));

    expect(positioned.glyphs).toEqual([]);
    expect(positioned.advance).toBe(0);
  });
});
