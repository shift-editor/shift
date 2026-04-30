import { describe, it, expect, beforeEach } from "vitest";
import type { Font } from "@/lib/model/Font";
import { Positioner } from "./Positioner";
import { glyphCell as glyph } from "./types";
import { loadTestFont, ltrRun } from "./testUtils";

describe("Positioner", () => {
  let font: Font;

  beforeEach(() => {
    font = loadTestFont();
  });

  // Levien invariant: positioned.advance === sum of xAdvance.
  it("advance equals sum of xAdvance", () => {
    const positioner = new Positioner();
    const run = ltrRun([glyph("A", 65), glyph("B", 66), glyph("C", 67)]);

    const positioned = positioner.position(run, font);

    const sum = positioned.glyphs.reduce((s, g) => s + g.xAdvance, 0);
    expect(positioned.advance).toBe(sum);
    expect(positioned.advance).toBeGreaterThan(0);
  });

  // cluster numbering honors clusterStart and is monotonic.
  it("cluster equals clusterStart + i", () => {
    const positioner = new Positioner();
    const run = ltrRun([glyph("A", 65), glyph("B", 66)], /* clusterStart */ 7);

    const positioned = positioner.position(run, font);

    expect(positioned.glyphs.map((g) => g.cluster)).toEqual([7, 8]);
  });

  // Each positioned glyph carries the bounds the font reports.
  it("bounds pass through from font.getBbox", () => {
    const positioner = new Positioner();
    const a = glyph("A", 65);
    const run = ltrRun([a]);

    const positioned = positioner.position(run, font);

    expect(positioned.glyphs[0].bounds).toEqual(font.getBbox("A"));
    expect(positioned.glyphs[0].cellIds).toEqual([a.id]);
    expect(positioned.glyphs[0].origin).toEqual({ x: 0, y: 0 });
  });

  // Glyph not in the font → zero advance, null bounds, no throw.
  it("handles missing glyph gracefully", () => {
    const positioner = new Positioner();
    const run = ltrRun([glyph("nonexistent-glyph-xyz", 65)]);

    const positioned = positioner.position(run, font);

    expect(positioned.glyphs[0].xAdvance).toBe(0);
    expect(positioned.glyphs[0].bounds).toBeNull();
  });

  // Empty run → empty positioned glyphs, zero advance.
  it("empty run yields empty positioned glyphs", () => {
    const positioner = new Positioner();
    const run = ltrRun([]);

    const positioned = positioner.position(run, font);

    expect(positioned.glyphs).toEqual([]);
    expect(positioned.advance).toBe(0);
  });
});
