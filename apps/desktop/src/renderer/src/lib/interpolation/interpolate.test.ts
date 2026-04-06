import { describe, it, expect } from "vitest";
import {
  interpolateGlyph,
  normalizeAxisValue,
  checkCompatibility,
  type MasterSnapshot,
} from "./interpolate";
import type { Axis, GlyphSnapshot, ContourSnapshot } from "@shift/types";

function makeAxis(overrides?: Partial<Axis>): Axis {
  return {
    tag: "wght",
    name: "Weight",
    minimum: 100,
    default: 400,
    maximum: 900,
    hidden: false,
    ...overrides,
  };
}

function makeContour(points: Array<{ x: number; y: number }>): ContourSnapshot {
  return {
    id: "c1" as never,
    closed: true,
    points: points.map((p, i) => ({
      id: `p${i}` as never,
      x: p.x,
      y: p.y,
      pointType: "onCurve" as never,
      smooth: false,
    })),
  };
}

function makeSnapshot(contours: ContourSnapshot[], xAdvance: number): GlyphSnapshot {
  return {
    unicode: 65,
    name: "A",
    xAdvance,
    contours,
    anchors: [],
    compositeContours: [],
    activeContourId: null,
  };
}

function makeMaster(
  name: string,
  wght: number,
  contour: ContourSnapshot,
  xAdvance: number,
): MasterSnapshot {
  return {
    sourceId: name,
    sourceName: name,
    location: { values: { wght } },
    snapshot: makeSnapshot([contour], xAdvance),
  };
}

describe("normalizeAxisValue", () => {
  const axis = makeAxis();

  it("returns 0 at default", () => {
    expect(normalizeAxisValue(400, axis)).toBe(0);
  });

  it("returns -1 at minimum", () => {
    expect(normalizeAxisValue(100, axis)).toBeCloseTo(-1);
  });

  it("returns 1 at maximum", () => {
    expect(normalizeAxisValue(900, axis)).toBeCloseTo(1);
  });

  it("returns -0.5 at midpoint below default", () => {
    expect(normalizeAxisValue(250, axis)).toBeCloseTo(-0.5);
  });
});

describe("checkCompatibility", () => {
  it("returns null for compatible masters", () => {
    const light = makeMaster(
      "Light",
      100,
      makeContour([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      500,
    );
    const bold = makeMaster(
      "Bold",
      900,
      makeContour([
        { x: 10, y: 0 },
        { x: 110, y: 0 },
      ]),
      600,
    );
    expect(checkCompatibility([light, bold])).toBeNull();
  });

  it("reports contour count mismatch", () => {
    const light = makeMaster("Light", 100, makeContour([{ x: 0, y: 0 }]), 500);
    const bold: MasterSnapshot = {
      ...makeMaster("Bold", 900, makeContour([{ x: 0, y: 0 }]), 600),
      snapshot: makeSnapshot([makeContour([{ x: 0, y: 0 }]), makeContour([{ x: 50, y: 50 }])], 600),
    };
    expect(checkCompatibility([light, bold])).toContain("2 contours");
  });

  it("reports point count mismatch", () => {
    const light = makeMaster("Light", 100, makeContour([{ x: 0, y: 0 }]), 500);
    const bold = makeMaster(
      "Bold",
      900,
      makeContour([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      600,
    );
    expect(checkCompatibility([light, bold])).toContain("points");
  });
});

describe("interpolateGlyph", () => {
  const axes = [makeAxis()];

  it("returns the single master's snapshot when only one master", () => {
    const master = makeMaster("Regular", 400, makeContour([{ x: 100, y: 200 }]), 500);
    const result = interpolateGlyph([master], axes, { wght: 400 });
    expect(result).toBe(master.snapshot);
  });

  it("interpolates at midpoint between two masters", () => {
    const light = makeMaster("Light", 100, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", 900, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 500 });

    expect(result).not.toBeNull();
    expect(result!.contours[0].points[0].x).toBeCloseTo(150);
    expect(result!.contours[0].points[0].y).toBeCloseTo(300);
    expect(result!.xAdvance).toBeCloseTo(600);
  });

  it("returns master A at master A location", () => {
    const light = makeMaster("Light", 100, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", 900, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 100 });

    expect(result!.contours[0].points[0].x).toBeCloseTo(100);
    expect(result!.contours[0].points[0].y).toBeCloseTo(200);
  });

  it("returns master B at master B location", () => {
    const light = makeMaster("Light", 100, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", 900, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 900 });

    expect(result!.contours[0].points[0].x).toBeCloseTo(200);
    expect(result!.contours[0].points[0].y).toBeCloseTo(400);
  });

  it("returns null for incompatible masters", () => {
    const light = makeMaster("Light", 100, makeContour([{ x: 0, y: 0 }]), 500);
    const bold = makeMaster(
      "Bold",
      900,
      makeContour([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      600,
    );

    const result = interpolateGlyph([light, bold], axes, { wght: 500 });
    expect(result).toBeNull();
  });

  it("preserves point metadata from reference master", () => {
    const light = makeMaster("Light", 100, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", 900, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 500 });

    expect(result!.contours[0].points[0].id).toBe(light.snapshot.contours[0].points[0].id);
    expect(result!.contours[0].points[0].pointType).toBe("onCurve");
    expect(result!.contours[0].id).toBe(light.snapshot.contours[0].id);
  });
});
