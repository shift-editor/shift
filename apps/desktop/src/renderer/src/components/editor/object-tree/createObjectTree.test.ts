import { describe, expect, it } from "vitest";
import { GlyphGeometry } from "@shift/glyph-state";
import { asContourId, asPointId } from "@shift/types";
import { createContourIconPath, createObjectTree } from "./createObjectTree";

const geometry = new GlyphGeometry(
  {
    contours: [
      {
        id: asContourId("mixed"),
        closed: false,
        points: [
          { id: asPointId("p0"), pointType: "onCurve", smooth: false },
          { id: asPointId("p1"), pointType: "onCurve", smooth: false },
          { id: asPointId("p2"), pointType: "onCurve", smooth: false },
          { id: asPointId("p3"), pointType: "offCurve", smooth: false },
          { id: asPointId("p4"), pointType: "onCurve", smooth: false },
        ],
      },
    ],
    anchors: [],
    components: [],
  },
  new Float64Array([500, 0, 0, 10, 0, 20, 0, 25, 10, 30, 0]),
);

describe("object tree contour descriptions", () => {
  it("labels the first point and describes remaining point geometry", () => {
    const contour = createObjectTree(geometry)[0]?.items[0];

    expect(contour?.children.map((point) => point.label)).toEqual([
      "First",
      "Line 1",
      "Curve 1",
      "Handle 1",
      "Curve 2",
    ]);
  });

  it("fits contour path geometry into the icon view box", () => {
    const contour = geometry.contours[0];
    if (!contour) throw new Error("Expected contour fixture");

    const iconPath = createContourIconPath(contour);

    expect(iconPath).toBe("M 1 8 L 5 8 L 9 8 Q 11 4 13 8");
  });
});
