import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { TestEditor } from "@/testing/TestEditor";
import { NONSPACING_MARK_EDITOR_ADVANCE, Positioner } from "@shift/editor/testing";
import { characterTextItem as char, glyphTextItem as glyph } from "@shift/editor/text";
import { layoutTestEditor, ltrRun } from "./testUtils";
import { effect, signal } from "@shift/editor/signals";
import type { GlyphName } from "@shift/types";
import { kerningValueEdit } from "@shift/editor/model";

describe("Positioner", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await layoutTestEditor();
  });

  // Levien invariant: positioned.advance === sum of xAdvance.
  it("advance equals sum of xAdvance", () => {
    const positioner = new Positioner(editor, signal(editor.font.defaultLocation()));
    const run = ltrRun(editor, [char(65), char(66), char(67)]);

    const positioned = positioner.position(run, "literal");

    const sum = positioned.glyphs.reduce((s, g) => s + g.xAdvance, 0);
    expect(positioned.advance).toBe(sum);
    expect(positioned.advance).toBeGreaterThan(0);
  });

  // cluster numbering honors clusterStart and is monotonic.
  it("cluster equals clusterStart + i", () => {
    const positioner = new Positioner(editor, signal(editor.font.defaultLocation()));
    const run = ltrRun(editor, [char(65), char(66)], /* clusterStart */ 7);

    const positioned = positioner.position(run, "literal");

    expect(positioned.glyphs.map((g) => g.cluster)).toEqual([7, 8]);
  });

  // Each positioned glyph carries the bounds from its resolved render model.
  it("bounds pass through from the Glyph render model", () => {
    const a = char(65);
    const run = ltrRun(editor, [a]);
    const locationCell = signal(editor.font.defaultLocation());
    const positioner = new Positioner(editor, locationCell);

    const positioned = positioner.position(run, "literal");
    const record = editor.font.recordForName("A");
    const expectedBounds = record
      ? (editor.glyphForId(record.id)?.renderModelAt(locationCell).bounds ?? null)
      : null;

    expect(positioned.glyphs[0].glyphId).toBe(record?.id);
    expect(positioned.glyphs[0].bounds).toEqual(expectedBounds);
    expect(positioned.glyphs[0].sourceItemIds).toEqual([a.id]);
    expect(positioned.glyphs[0].origin).toEqual({ x: 0, y: 0 });
  });

  // Character the font maps no glyph to → zero advance, null bounds, no throw.
  it("handles an unmapped character gracefully", () => {
    const positioner = new Positioner(editor, signal(editor.font.defaultLocation()));
    const run = ltrRun(editor, [char(0x10fffd)]);

    const positioned = positioner.position(run, "literal");

    expect(positioned.glyphs[0].xAdvance).toBe(0);
    expect(positioned.glyphs[0].bounds).toBeNull();
    expect(positioned.glyphs[0].glyphId).toBeNull();
  });

  describe("nonspacing marks follow the category export resolves", () => {
    async function addZeroWidthGlyph(name: string, unicode: number | null = null): Promise<void> {
      await editor.addGlyph(name, unicode);
      const record = editor.font.recordForName(name as GlyphName)!;
      editor.glyphForId(record.id)!.layerForSource(editor.font.defaultSource.id)!.setXAdvance(0);
      await editor.settle();
    }

    const id = (name: string) => editor.font.recordForName(name as GlyphName)!.id;

    function positionedAfterA(name: string) {
      const run = ltrRun(editor, [char(65), glyph(id(name))]);
      return new Positioner(editor, signal(editor.font.defaultLocation())).position(run, "literal")
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

    it("kerns a glyph named like a mark against its neighbour, but not a nonspacing mark", async () => {
      await addZeroWidthGlyph("x.comb");
      await addZeroWidthGlyph("fatha-ar");
      const sourceId = editor.font.defaultSource.id;
      editor.font.setKerningValues(
        ["x.comb", "fatha-ar"].map((name) =>
          kerningValueEdit(sourceId, { first: id("A"), second: id(name) }, -30),
        ),
        "Kern",
      );
      await editor.settle();

      const kernAfterA = (name: string) => {
        const run = ltrRun(editor, [char(65), glyph(id(name))]);
        return new Positioner(editor, signal(editor.font.defaultLocation())).position(
          run,
          "literal",
        ).glyphs[0]!.xKern;
      };
      expect(kernAfterA("x.comb")).toBe(-30);
      expect(kernAfterA("fatha-ar")).toBe(0);
    });

    it("lays out a character with no glyph as spacing, then as a mark once the glyph exists", async () => {
      // Laid out as typed: shaped text gives a mark the font classes as one no advance.
      const run = editor.text.createRun([char(65), char(0x064e)]);
      editor.history.capture("Shaping off", () => editor.text.setShaping(run.id, false));
      const layoutCell = editor.text.layoutCell(run.id);
      const advances: number[] = [];
      const subscription = effect(() => {
        advances.push(layoutCell.value!.placedGlyphs[1]!.glyph.xAdvance);
      });

      await addZeroWidthGlyph("fatha-ar", 0x064e);
      subscription.dispose();

      expect(advances[0]).toBe(0);
      expect(advances.at(-1)).toBe(NONSPACING_MARK_EDITOR_ADVANCE);
    });
  });

  // Empty run → empty positioned glyphs, zero advance.
  it("empty run yields empty positioned glyphs", () => {
    const positioner = new Positioner(editor, signal(editor.font.defaultLocation()));
    const run = ltrRun(editor, []);

    const positioned = positioner.position(run, "literal");

    expect(positioned.glyphs).toEqual([]);
    expect(positioned.advance).toBe(0);
  });
});

describe("Positioner mark attachment", () => {
  const FIXTURE = resolve(process.cwd(), "../../fixtures/fonts/AnchorPropagation.glyphs");
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().openSession(FIXTURE, "a");
    for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  });

  const id = (name: string) => editor.font.recordForName(name as GlyphName)!.id;

  // `aacute` has no anchors of its own: its `top` is `acutecomb`'s, copied in by propagation.
  it("attaches a mark to an anchor a composite takes from its components", () => {
    const literal = ltrRun(editor, [glyph(id("aacute")), glyph(id("acutecomb"))]);
    // The shaper flags acutecomb as a mark from the compiled font's GDEF.
    const run = {
      ...literal,
      shaped: literal.shaped.map((shaped, index) => ({ ...shaped, isMark: index === 1 })),
    };

    const [base, mark] = new Positioner(editor, signal(editor.font.defaultLocation())).position(
      run,
      "anchors",
    ).glyphs;

    expect(mark!.origin).toEqual(base!.origin);
    // acutecomb's `top` (100, 700) moved by its component offset (150, 0), less its `_top` (100, 500).
    expect({ x: mark!.xOffset, y: mark!.yOffset }).toEqual({ x: 150, y: 200 });
    expect(mark!.xAdvance).toBe(0);
  });
});
