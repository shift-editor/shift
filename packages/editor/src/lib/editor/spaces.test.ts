import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import { applyLinear, localPoint, localVector, spaceTransform, transformBounds } from "./spaces";

/** Places a glyph's font units on the scene: origin at (100, 500), Y flipped. */
const placement = spaceTransform<"local", "scene">(
  Mat.Compose(Mat.Translate(100, 500), Mat.Scale(1, -1)),
);

describe("applyLinear", () => {
  it("flips a displacement without moving it by the placement's translation", () => {
    expect(applyLinear(placement, localVector(10, 20))).toEqual({ x: 10, y: -20 });
  });
});

describe("transformBounds", () => {
  it("keeps min below max when a flip swaps the corners", () => {
    const glyphBox = { min: localPoint(0, -200), max: localPoint(500, 700) };

    expect(transformBounds(placement, glyphBox)).toEqual({
      min: { x: 100, y: -200 },
      max: { x: 600, y: 700 },
    });
  });

  it("encloses every corner of a rotated box", () => {
    const quarterTurn = spaceTransform<"local", "scene">(Mat.Rotate(Math.PI / 4));
    const unitSquare = { min: localPoint(0, 0), max: localPoint(1, 1) };

    const bounds = transformBounds(quarterTurn, unitSquare);

    expect(bounds.min.x).toBeCloseTo(-Math.SQRT1_2);
    expect(bounds.max.x).toBeCloseTo(Math.SQRT1_2);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(Math.SQRT2);
  });
});
