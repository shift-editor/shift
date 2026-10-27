import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { TestEditor } from "@/testing/TestEditor";
import {
  NONSPACING_MARK_EDITOR_ADVANCE,
  characterTextItem as char,
  glyphTextItem as glyph,
  lineBreakTextItem,
  type TextItem,
} from "@shift/editor/text";
import { layoutTestEditor, makeLayout, runLayout } from "./testUtils";
import { effect } from "@shift/editor/signals";
import type { GlyphName } from "@shift/types";
import { kerningValueEdit } from "@shift/editor/model";

describe("Positioner", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await layoutTestEditor();
  });

  /** The positioned run of a single-paragraph layout. */
  const firstRun = (items: readonly TextItem[]) => makeLayout(items, editor).lines[0]!.runs[0]!;

  // Levien invariant: positioned.advance === sum of xAdvance.
  it("advance equals sum of xAdvance", () => {
    const positioned = firstRun([char(65), char(66), char(67)]);

    const sum = positioned.glyphs.reduce((s, g) => s + g.xAdvance, 0);
    expect(positioned.advance).toBe(sum);
    expect(positioned.advance).toBeGreaterThan(0);
  });

  // cluster numbering honors the paragraph's clusterStart and is monotonic.
  it("cluster equals clusterStart + i", () => {
    const layout = makeLayout([char(65), lineBreakTextItem(), char(65), char(66)], editor);

    const positioned = layout.lines[1]!.runs[0]!;

    expect(positioned.glyphs.map((g) => g.cluster)).toEqual([2, 3]);
  });

  it("places a glyph with its id and the items it came from", () => {
    const a = char(65);

    const positioned = firstRun([a]);

    expect(positioned.glyphs[0].glyphId).toBe(editor.font.recordForName("A")?.id);
    expect(positioned.glyphs[0].sourceItemIds).toEqual([a.id]);
    expect(positioned.glyphs[0].origin).toEqual({ x: 0, y: 0 });
  });

  // Character the font maps no glyph to → zero advance, no throw.
  it("handles an unmapped character gracefully", () => {
    const positioned = firstRun([char(0x10fffd)]);

    expect(positioned.glyphs[0].xAdvance).toBe(0);
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
      return firstRun([char(65), glyph(id(name))]).glyphs[1]!;
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

      const kernAfterA = (name: string) => firstRun([char(65), glyph(id(name))]).glyphs[0]!.xKern;
      expect(kernAfterA("x.comb")).toBe(-30);
      expect(kernAfterA("fatha-ar")).toBe(0);
    });

    it("lays out a character with no glyph as spacing, then as a mark once the glyph exists", async () => {
      const run = editor.text.createRun([char(65), char(0x064e)]);
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

  // Empty paragraph → empty positioned glyphs, zero advance.
  it("empty run yields empty positioned glyphs", () => {
    const layout = makeLayout([lineBreakTextItem()], editor);

    const runs = layout.lines.flatMap((line) => line.runs);

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.glyphs)).toEqual([[], []]);
    expect(runs.map((run) => run.advance)).toEqual([0, 0]);
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
  it("attaches a mark to an anchor a composite takes from its components", async () => {
    const run = editor.text.createRun([glyph(id("aacute")), glyph(id("acutecomb"))]);
    // Shaped text places marks by their anchors.
    await editor.text.settled();

    const [base, mark] = runLayout(editor, run.id).lines[0]!.runs[0]!.glyphs;

    expect(mark!.origin).toEqual(base!.origin);
    // acutecomb's `top` (100, 700) moved by its component offset (150, 0), less its `_top` (100, 500).
    expect({ x: mark!.xOffset, y: mark!.yOffset }).toEqual({ x: 150, y: 200 });
    expect(mark!.xAdvance).toBe(0);
  });

  describe("re-lays out a run when its anchors move, not when only its outline does", () => {
    async function liveLayout() {
      const run = editor.text.createRun([glyph(id("a")), glyph(id("acutecomb"))]);
      const layout = editor.text.layoutCell(run.id);
      // Subscribed the way the canvas holds a run's layout.
      const subscription = effect(() => void layout.value);
      await editor.text.settled();
      const marks = () => layout.peek()!.lines[0]!.runs[0]!;
      return { layout, marks, subscription };
    }

    it("keeps the layout while a point moves", async () => {
      const layer = editor.requireGlyphLayer();
      const contourId = layer.addContour();
      const pointId = layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
      await editor.settle();
      const { layout, subscription } = await liveLayout();
      const before = layout.peek();

      layer.previewPositionPatch([{ kind: "point", id: pointId, x: 40, y: 0 }]);
      subscription.dispose();

      expect(layout.peek()).toBe(before);
    });

    it("moves the mark with the anchor it sits on", async () => {
      const { marks, subscription } = await liveLayout();
      const before = marks().glyphs[1]!;

      const layer = editor.requireGlyphLayer();
      const top = layer.anchors.find((anchor) => anchor.name === "top")!;
      layer.previewPositionPatch([{ kind: "anchor", id: top.id, x: top.x + 40, y: top.y }]);
      subscription.dispose();

      expect(marks().glyphs[1]!.xOffset).toBe(before.xOffset + 40);
    });
  });
});
