import { describe, expect, it } from "vitest";
import { asContourId, asPointId, type GlyphStructure } from "@shift/types";
import { GlyphGeometry } from "./GlyphGeometry";

function geometryWithOvershootingControl(): GlyphGeometry {
  const structure: GlyphStructure = {
    contours: [
      {
        id: asContourId("contour-1"),
        closed: false,
        points: [
          { id: asPointId("point-1"), pointType: "onCurve", smooth: false },
          { id: asPointId("point-2"), pointType: "offCurve", smooth: false },
          { id: asPointId("point-3"), pointType: "onCurve", smooth: false },
        ],
      },
    ],
    anchors: [],
    components: [],
  };

  return new GlyphGeometry(structure, new Float64Array([600, 0, 0, -100, 100, 200, 0]));
}

describe("glyph metric bounds", () => {
  it("uses tight curve bounds instead of raw control-point extents", () => {
    const geometry = geometryWithOvershootingControl();

    expect(geometry.bounds?.min.x).toBeCloseTo(-25);
    expect(geometry.bounds?.max).toEqual({ x: 200, y: 50 });
    expect(geometry.sidebearings.lsb).toBeCloseTo(-25);
    expect(geometry.sidebearings.rsb).toBe(400);
  });
});
