import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import { asContourId, asPointId } from "@shift/types";
import type { GlyphRenderContour, PlacedContours } from "../../types/glyphRender";
import { blendDecomposedGlyph } from "./decomposedComponents";
import { RenderContour } from "./GlyphRenderModel";

class Contour extends RenderContour {
  readonly id = asContourId("c");
  readonly points: readonly Point[];

  constructor(
    readonly closed: boolean,
    coordinates: readonly (readonly [number, number])[],
  ) {
    super();
    this.points = coordinates.map(
      ([x, y], index) =>
        new Point({ id: asPointId(`p${index}`), x, y, pointType: "onCurve", smooth: false }),
    );
  }
}

const square = (size: number): GlyphRenderContour =>
  new Contour(true, [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ]);

const master = (contours: GlyphRenderContour[], matrix = Mat.Identity()): PlacedContours => ({
  matrix,
  contours,
});

describe("blendDecomposedGlyph", () => {
  const triangle = () =>
    new Contour(true, [
      [0, 0],
      [100, 0],
      [0, 100],
    ]);

  it("returns null when an occurrence's masters don't line up point for point", () => {
    expect(
      blendDecomposedGlyph([[master([square(100)]), master([triangle()])]], [0.5, 0.5]),
    ).toBeNull();
    expect(
      blendDecomposedGlyph(
        [[master([square(100)]), master([square(100), square(50)])]],
        [0.5, 0.5],
      ),
    ).toBeNull();
  });

  it("blends no occurrence when one doesn't line up, as compilers decompose the whole glyph", () => {
    const lines = [master([square(100)]), master([square(200)])];
    const fails = [master([square(100)]), master([triangle()])];

    expect(blendDecomposedGlyph([lines], [0.5, 0.5])).not.toBeNull();
    expect(blendDecomposedGlyph([lines, fails], [0.5, 0.5])).toBeNull();
  });

  it("returns null when the weights don't match the masters", () => {
    expect(blendDecomposedGlyph([[master([square(100)]), master([square(200)])]], [1])).toBeNull();
  });

  it("keeps the first master's point identities in placed order", () => {
    const mirrored = Mat.Compose(Mat.Translate(200, 0), Mat.Scale(-1, 1));

    const blended = blendDecomposedGlyph(
      [[master([square(100)], mirrored), master([square(100)], mirrored)]],
      [0.5, 0.5],
    );
    const contour = blended?.[0]?.[0];

    // A mirrored placement reverses a closed contour after its start point.
    expect(contour!.points.map((point) => point.id)).toEqual(["p0", "p3", "p2", "p1"]);
    expect(contour!.points.map(({ x, y }) => [x, y])).toEqual([
      [200, 0],
      [200, 100],
      [100, 100],
      [100, 0],
    ]);
  });
});
