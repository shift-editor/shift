import { describe, it, expect, beforeEach } from "vitest";
import { glyphCell as glyph, linebreakCell } from "./types";
import { loadTestFont, makeLayout } from "./testUtils";
import { Font } from "@/lib/model/Font";

describe("TextLayout", () => {
  let font: Font;

  beforeEach(() => {
    font = loadTestFont();
  });

  // Levien invariant via the public class surface.
  it("measure equals sum of xAdvance across all runs", () => {
    const layout = makeLayout([glyph("A", 65), glyph("B", 66), glyph("C", 67)], font);

    const sum = layout.lines
      .flatMap((l) => l.runs)
      .flatMap((r) => r.glyphs)
      .reduce((s, g) => s + g.xAdvance, 0);

    expect(layout.measure()).toBe(sum);
    expect(layout.totalAdvance).toBe(sum);
    expect(layout.totalAdvance).toBeGreaterThan(0);
  });

  // Empty input → no lines, zero advance.
  it("empty cell buffer producesNoShapePositionerand zero advance", () => {
    const layout = makeLayout([], font);

    expect(layout.lines).toEqual([]);
    expect(layout.totalAdvance).toBe(0);
  });

  // Linebreak cell splits the buffer into two lines.
  it("splits on linebreak cell into separate lines", () => {
    const layout = makeLayout([glyph("A", 65), linebreakCell(), glyph("B", 66)], font);

    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[1].y).toBeLessThan(layout.lines[0].y);
  });

  // Second-line baseline math: y = origin.y - lineHeight.
  it("second-line baseline is one lineHeight below first", () => {
    const layout = makeLayout([glyph("A", 65), linebreakCell(), glyph("B", 66)], font);
    const metrics = font.getMetrics();
    const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);

    expect(layout.lines[0].y).toBe(0);
    expect(layout.lines[1].y).toBe(-lineHeight);
  });

  // hit-test → pointAt round trip. Pin side resolution: a point inside the
  // left half of B's advance box hits cluster=1, side="left".
  it("pointAt after hitTest recovers cluster's leading edge", () => {
    const layout = makeLayout([glyph("A", 65), glyph("B", 66)], font);
    const aAdvance = font.glyph("A")?.advance ?? 0;
    const bAdvance = font.glyph("B")?.advance ?? 0;
    const bLeftHalfX = aAdvance + bAdvance / 4;

    const hit = layout.hitTest({ x: bLeftHalfX, y: 0 });

    expect(hit).toEqual({ lineIndex: 0, runIndex: 0, cluster: 1, side: "left" });
    expect(layout.pointAt(1)?.x).toBe(aAdvance);
  });

  it("resolves edit origin by cell id on the current line", () => {
    const a = glyph("A", 65);
    const b = glyph("B", 66);
    const layout = makeLayout([a, b], font);
    const aAdvance = font.glyph("A")?.advance ?? 0;

    expect(layout.editOriginForCell(b.id)).toEqual({ x: aAdvance, y: 0 });
    expect(layout.primaryGlyphForCell(b.id)?.cellIds).toEqual([b.id]);
  });

  it("resolves edit origin by cell id after a linebreak", () => {
    const b = glyph("B", 66);
    const layout = makeLayout([glyph("A", 65), linebreakCell(), b], font);

    expect(layout.editOriginForCell(b.id)).toEqual({ x: 0, y: layout.lines[1].y });
  });

  it("returns anchors with cell ids rather than cluster-only hits", () => {
    const b = glyph("B", 66);
    const layout = makeLayout([glyph("A", 65), b], font);
    const aAdvance = font.glyph("A")?.advance ?? 0;

    expect(layout.anchorAtPoint("run-1", { x: aAdvance + 1, y: 0 })).toEqual({
      runId: "run-1",
      cellId: b.id,
    });
  });
});
