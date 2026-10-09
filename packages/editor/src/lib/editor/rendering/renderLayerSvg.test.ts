import { describe, expect, it } from "vitest";
import { GlyphGeometry } from "@shift/glyph-state";
import { asAnchorId, asComponentId, asContourId, asGlyphId, asPointId } from "@shift/types";
import { renderLayerSvg } from "./renderLayerSvg";

const metrics = {
  unitsPerEm: 1000,
  metricValues: [],
  ascender: 800,
  capHeight: 700,
  xHeight: 500,
  baseline: 0,
  descender: -200,
};

const geometry = new GlyphGeometry(
  {
    contours: [
      {
        id: asContourId("contour-1"),
        closed: true,
        points: [
          { id: asPointId("point-1"), pointType: "onCurve", smooth: false },
          { id: asPointId("point-2"), pointType: "offCurve", smooth: false },
          { id: asPointId("point-3"), pointType: "offCurve", smooth: false },
          { id: asPointId("point-4"), pointType: "onCurve", smooth: true },
        ],
      },
    ],
    anchors: [{ id: asAnchorId("anchor-1"), name: "top" }],
    components: [],
  },
  new Float64Array([500, 0, 0, 0, 100, 100, 100, 100, 0, 50, 120]),
);

const resolved = {
  outline: {
    svgPath: "M 0 0 C 0 100 100 100 100 0 L 0 0 Z",
    bounds: { min: { x: 0, y: 0 }, max: { x: 100, y: 75 } },
  },
  components: [],
};

describe("authored layer SVG output", () => {
  it("includes paths and source-addressable proof overlays", () => {
    const result = renderLayerSvg({
      authored: geometry,
      resolved,
      metrics,
      overlays: {
        points: true,
        controlLines: true,
        anchors: true,
        fontMetrics: true,
        advanceWidth: true,
      },
      appearance: { outlineFill: "#123456", metricStroke: "#654321" },
    });

    expect(result.svg).toContain('data-shift-role="outline"');
    expect(result.svg).toContain('d="M 0 0 C 0 100 100 100 100 0 L 0 0 Z"');
    expect(result.svg).toContain('data-shift-role="control-lines"');
    expect(result.svg).toContain('data-shift-role="font-metrics"');
    expect(result.svg).toContain('data-shift-metric="capHeight"');
    expect(result.svg).toContain('data-shift-role="advance-width"');
    expect(result.svg).toContain('fill="#123456"');
    expect(result.svg).toContain('stroke="#654321"');
    expect(result.svg).toContain('data-shift-id="point-2"');
    expect(result.svg).toContain('data-shift-id="anchor-1"');
    expect(result.svg).toContain(">top</text>");
    expect(result.guides.fontMetrics.capHeight).toBe(700);
    expect(result.guides.advanceWidth.advance).toBe(500);
    expect(result.viewBox[2]).toBeGreaterThan(500);
  });

  it("fills the resolved outline and outlines each direct component subtree", () => {
    const componentId = asComponentId("component-1");
    const result = renderLayerSvg({
      authored: geometry,
      resolved: {
        outline: {
          svgPath: "M 0 0 L 100 0 Z M 600 0 L 700 0 L 700 100 Z M 650 150 L 660 150 Z",
          bounds: { min: { x: 0, y: 0 }, max: { x: 700, y: 150 } },
        },
        components: [
          {
            id: componentId,
            baseGlyphId: asGlyphId("glyph-b"),
            transformation: { xx: 1, xy: 0, yx: 0, yy: 1, dx: 600, dy: 0 },
            outline: {
              svgPath: "M 600 0 L 700 0 L 700 100 Z M 650 150 L 660 150 Z",
              bounds: { min: { x: 600, y: 0 }, max: { x: 700, y: 150 } },
            },
          },
        ],
      },
      metrics,
      overlays: { components: true },
    });

    expect(result.svg).toContain(
      'd="M 0 0 L 100 0 Z M 600 0 L 700 0 L 700 100 Z M 650 150 L 660 150 Z"',
    );
    expect(result.svg).toContain('data-shift-role="components"');
    expect(result.svg).toContain(
      '<g data-shift-role="component" data-shift-id="component-1"><rect x="600" y="-150" width="100" height="150"',
    );
    expect(result.svg).toContain('<circle cx="600" cy="0"');
    expect(result.viewBox[0] + result.viewBox[2]).toBeGreaterThan(700);
  });

  it("keeps annotations opt-in", () => {
    const result = renderLayerSvg({ authored: geometry, resolved, metrics });

    expect(result.svg).toContain('data-shift-role="outline"');
    expect(result.svg).not.toContain('data-shift-role="points"');
    expect(result.svg).not.toContain('data-shift-role="anchors"');
    expect(result.svg).not.toContain('data-shift-role="font-metrics"');
    expect(result.svg).not.toContain('data-shift-role="advance-width"');
    expect(result.svg).not.toContain('data-shift-role="components"');
  });
});
