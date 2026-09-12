import { beforeEach, describe, expect, it } from "vitest";
import {
  asAnchorId,
  asComponentId,
  asContourId,
  asGlyphId,
  asPointId,
  type GlyphStructure,
} from "@shift/types";
import { glyphStructuresEqual } from "./glyphStructuresEqual";

let structure: GlyphStructure;
let copy: GlyphStructure;

beforeEach(() => {
  structure = {
    contours: [
      {
        id: asContourId("contour"),
        closed: false,
        points: [
          { id: asPointId("first"), pointType: "onCurve", smooth: false },
          { id: asPointId("last"), pointType: "qCurve", smooth: true },
        ],
      },
    ],
    anchors: [{ id: asAnchorId("anchor"), name: "top" }],
    components: [
      { id: asComponentId("component"), baseGlyphId: asGlyphId("base"), baseGlyphName: "A" },
    ],
  };
  copy = JSON.parse(JSON.stringify(structure));
});

describe("glyph structure equality preserves every ordered metadata field", () => {
  it("accepts shared and independently deserialized identical structures", () => {
    expect(glyphStructuresEqual(structure, structure)).toBe(true);
    expect(glyphStructuresEqual(structure, copy)).toBe(true);
  });

  it.each([
    "contour count",
    "contour identity",
    "closure",
    "point count",
    "point order",
    "point identity",
    "point type",
    "smoothness",
    "anchor count",
    "anchor identity",
    "anchor name",
    "component count",
    "component identity",
    "base glyph identity",
    "base glyph name",
  ])("rejects changed %s", (field) => {
    switch (field) {
      case "contour count":
        copy.contours.pop();
        break;
      case "contour identity":
        copy.contours[0]!.id = asContourId("other");
        break;
      case "closure":
        copy.contours[0]!.closed = true;
        break;
      case "point count":
        copy.contours[0]!.points.pop();
        break;
      case "point order":
        copy.contours[0]!.points.reverse();
        break;
      case "point identity":
        copy.contours[0]!.points[0]!.id = asPointId("other");
        break;
      case "point type":
        copy.contours[0]!.points[0]!.pointType = "offCurve";
        break;
      case "smoothness":
        copy.contours[0]!.points[0]!.smooth = true;
        break;
      case "anchor count":
        copy.anchors.pop();
        break;
      case "anchor identity":
        copy.anchors[0]!.id = asAnchorId("other");
        break;
      case "anchor name":
        copy.anchors[0]!.name = "bottom";
        break;
      case "component count":
        copy.components.pop();
        break;
      case "component identity":
        copy.components[0]!.id = asComponentId("other");
        break;
      case "base glyph identity":
        copy.components[0]!.baseGlyphId = asGlyphId("other");
        break;
      case "base glyph name":
        copy.components[0]!.baseGlyphName = "B";
        break;
    }
    expect(glyphStructuresEqual(structure, copy)).toBe(false);
    expect(glyphStructuresEqual(copy, structure)).toBe(false);
  });
});
