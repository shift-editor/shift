import { describe, expect, it } from "vitest";
import type { SourceMetrics } from "@shift/types";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";

const METRICS: SourceMetrics = {
  unitsPerEm: 1000,
  metricValues: [],
  ascender: 800,
  descender: -200,
  baseline: 0,
};

describe("Glyph preview layout", () => {
  it("derives one view box from source metrics and advance", () => {
    const layout = new GlyphPreviewLayout(METRICS, 500, 75);

    expect(layout.viewBox).toBe("0 -1000 500 1250");
    expect(layout.width).toBe(75);
    expect(layout.height).toBe(75);
  });

  it("allows a wide Glyph to exceed the preview height", () => {
    const layout = new GlyphPreviewLayout(METRICS, 2000, 75);

    expect(layout.width).toBe(120);
  });

  it("keeps an empty Glyph layout visible", () => {
    const layout = new GlyphPreviewLayout(METRICS, 0, 75);

    expect(layout.viewBox).toBe("0 -1000 1 1250");
    expect(layout.width).toBe(75);
  });
});
