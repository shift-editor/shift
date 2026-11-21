import { describe, expect, it } from "vitest";
import { ascending } from "@shift/types";
import type { GlyphGuideMetrics } from "../../../../types/glyphRender";
import type { Canvas } from "../Canvas";
import { Guides } from "./Guides";

const METRICS: GlyphGuideMetrics = {
  ascender: 800,
  capHeight: 700,
  xHeight: 500,
  descender: -200,
};

interface Segment {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}

/** Draws the guides on a recording canvas and returns the line segments they moved through. */
function drawnSegments(advance: number): Segment[] {
  const segments: Segment[] = [];
  let from: readonly [number, number] = [0, 0];
  const canvas = {
    theme: { guides: { color: "#000", widthPx: 1 } },
    ctx: {
      beginPath() {},
      moveTo(x: number, y: number) {
        from = [x, y];
      },
      lineTo(x: number, y: number) {
        segments.push({ from, to: [x, y] });
      },
    },
    stroke() {},
  } as unknown as Canvas;

  new Guides().draw(canvas, METRICS, advance, false);

  return segments;
}

describe("metric guides", () => {
  it("draws the vertical lines at the glyph origin and its advance", () => {
    const vertical = drawnSegments(600).filter((segment) => segment.from[0] === segment.to[0]);

    expect(vertical.map((segment) => segment.from[0]).sort(ascending)).toEqual([0, 600]);
  });

  it("draws every horizontal line across the advance box", () => {
    const horizontal = drawnSegments(600).filter((segment) => segment.from[1] === segment.to[1]);

    expect(horizontal.map((segment) => segment.from[1]).sort(ascending)).toEqual([
      -200, 0, 500, 700, 800,
    ]);
    for (const segment of horizontal) {
      expect([segment.from[0], segment.to[0]]).toEqual([0, 600]);
    }
  });
});
