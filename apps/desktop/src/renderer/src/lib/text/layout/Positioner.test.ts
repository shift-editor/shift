import { describe, it, expect, beforeEach } from "vitest";
import type { TestEditor } from "@/testing/TestEditor";
import { Positioner } from "@shift/editor/testing";
import { characterTextItem as char } from "@shift/editor/text";
import { layoutTestEditor, ltrRun } from "./testUtils";
import { signal } from "@shift/editor/signals";

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

  // Empty run → empty positioned glyphs, zero advance.
  it("empty run yields empty positioned glyphs", () => {
    const positioner = new Positioner(editor, signal(editor.font.defaultLocation()));
    const run = ltrRun(editor, []);

    const positioned = positioner.position(run, "literal");

    expect(positioned.glyphs).toEqual([]);
    expect(positioned.advance).toBe(0);
  });
});
