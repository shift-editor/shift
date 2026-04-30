import { describe, it, expect, beforeEach } from "vitest";
import type { Font } from "@/lib/model/Font";
import { Caret } from "./Caret";
import { glyphCell as glyph, linebreakCell } from "./types";
import { loadTestFont, makeLayout } from "./testUtils";

describe("Caret", () => {
  let font: Font;

  beforeEach(() => {
    font = loadTestFont();
  });

  // atCluster preserves the cluster index.
  it("atCluster returns a caret at the requested cluster", () => {
    const layout = makeLayout([glyph("A", 65), glyph("B", 66)], font);

    expect(Caret.atCluster(layout, 0).cluster).toBe(0);
    expect(Caret.atCluster(layout, 1).cluster).toBe(1);
  });

  // next advances by one cluster within a paragraph.
  it("next advances by one cluster", () => {
    const layout = makeLayout([glyph("A", 65), glyph("B", 66)], font);
    const c0 = Caret.atCluster(layout, 0);

    expect(c0.next().cluster).toBe(1);
    expect(c0.next().next().cluster).toBe(2);
  });

  // next at end clamps (does not run past the buffer).
  it("next clamps at buffer end", () => {
    const layout = makeLayout([glyph("A", 65)], font);
    const end = Caret.atCluster(layout, 1);

    expect(end.next().cluster).toBe(1);
  });

  // next steps through paragraph boundary. Buffer = [A, \n, B].
  // Caret 0 (before A) → 1 (end of line 1, before linebreak)
  //                    → 2 (start of line 2, before B)
  it("next steps through paragraph boundary", () => {
    const layout = makeLayout([glyph("A", 65), linebreakCell(), glyph("B", 66)], font);
    const metrics = font.getMetrics();
    const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);
    let c = Caret.atCluster(layout, 0);

    c = c.next();
    expect(c.cluster).toBe(1);
    expect(c.position().y).toBe(0);

    c = c.next();
    expect(c.cluster).toBe(2);
    expect(c.position().y).toBe(-lineHeight);
  });

  // previous clamps at buffer start.
  it("previous clamps at buffer start", () => {
    const layout = makeLayout([glyph("A", 65)], font);
    const start = Caret.atCluster(layout, 0);

    expect(start.previous().cluster).toBe(0);
  });

  // Regression: pressing Enter at the end of a buffer puts the caret on the
  // empty line *after* the linebreak (line 1 baseline), not back at origin
  // on line 0. Buffer = [A, \n] has bufferLength = 2; cluster 2 is the
  // empty trailing paragraph.
  //
  //   line 0  A  ⏎    ←  cluster 0 = before A; cluster 1 = end of line 0
  //   line 1                  cluster 2 = empty line 1 (caret sits at originX)
  it("position on empty trailing line lands at that line's baseline", () => {
    const layout = makeLayout([glyph("A", 65), linebreakCell()], font);
    const metrics = font.getMetrics();
    const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);
    const caret = Caret.atCluster(layout, 2);

    const pos = caret.position();
    expect(pos.x).toBe(layout.origin.x);
    expect(pos.y).toBe(-lineHeight);
  });

  // Regression: caret between two consecutive linebreaks lands on the empty
  // middle line, not line 0.
  //
  //   line 0  ⏎              cluster 0
  //   line 1  ⏎              cluster 1  ← we want this
  //   line 2                  cluster 2
  it("position on empty line between two linebreaks lands on the middle line", () => {
    const layout = makeLayout([linebreakCell(), linebreakCell()], font);
    const metrics = font.getMetrics();
    const lineHeight = metrics.ascender - metrics.descender + (metrics.lineGap ?? 0);
    const caret = Caret.atCluster(layout, 1);

    const pos = caret.position();
    expect(pos.x).toBe(layout.origin.x);
    expect(pos.y).toBe(-lineHeight);
  });
});
