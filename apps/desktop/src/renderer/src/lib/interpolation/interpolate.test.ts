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
    minimum: 0,
    default: 0,
    maximum: 1000,
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
  locationValues: Record<string, number>,
  contour: ContourSnapshot,
  xAdvance: number,
): MasterSnapshot {
  return {
    sourceId: name,
    sourceName: name,
    location: { values: locationValues },
    snapshot: makeSnapshot([contour], xAdvance),
  };
}

describe("normalizeAxisValue", () => {
  const axis = makeAxis({ minimum: 100, default: 400, maximum: 900 });

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
      { wght: 0 },
      makeContour([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      500,
    );
    const bold = makeMaster(
      "Bold",
      { wght: 1000 },
      makeContour([
        { x: 10, y: 0 },
        { x: 110, y: 0 },
      ]),
      600,
    );
    expect(checkCompatibility([light, bold])).toBeNull();
  });

  it("reports contour count mismatch", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const bold: MasterSnapshot = {
      ...makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 0, y: 0 }]), 600),
      snapshot: makeSnapshot([makeContour([{ x: 0, y: 0 }]), makeContour([{ x: 50, y: 50 }])], 600),
    };
    expect(checkCompatibility([light, bold])).toContain("2 contours");
  });

  it("reports point count mismatch", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const bold = makeMaster(
      "Bold",
      { wght: 1000 },
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
    const master = makeMaster("Regular", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const result = interpolateGlyph([master], axes, { wght: 0 });
    expect(result).toBe(master.snapshot);
  });

  it("interpolates at midpoint between two masters", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 500 });

    expect(result).not.toBeNull();
    expect(result!.contours[0].points[0].x).toBeCloseTo(150);
    expect(result!.contours[0].points[0].y).toBeCloseTo(300);
    expect(result!.xAdvance).toBeCloseTo(600);
  });

  it("returns default master at default location", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 0 });

    expect(result!.contours[0].points[0].x).toBeCloseTo(100);
    expect(result!.contours[0].points[0].y).toBeCloseTo(200);
  });

  it("returns non-default master at its location", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 1000 });

    expect(result!.contours[0].points[0].x).toBeCloseTo(200);
    expect(result!.contours[0].points[0].y).toBeCloseTo(400);
  });

  it("falls back to default master when all others are incompatible", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const bold = makeMaster(
      "Bold",
      { wght: 1000 },
      makeContour([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      600,
    );

    const result = interpolateGlyph([light, bold], axes, { wght: 500 });
    expect(result).toBe(light.snapshot);
  });

  it("preserves point metadata from reference master", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([light, bold], axes, { wght: 500 });

    expect(result!.contours[0].points[0].id).toBe(light.snapshot.contours[0].points[0].id);
    expect(result!.contours[0].points[0].pointType).toBe("onCurve");
    expect(result!.contours[0].id).toBe(light.snapshot.contours[0].id);
  });

  it("interpolates with 4 masters on 2 axes", () => {
    const wdthAxis = makeAxis({ tag: "wdth", name: "Width" });
    const wghtAxis = makeAxis({ tag: "wght", name: "Weight" });

    const lc = makeMaster(
      "LightCondensed",
      { wdth: 0, wght: 0 },
      makeContour([{ x: 0, y: 0 }]),
      400,
    );
    const bc = makeMaster(
      "BoldCondensed",
      { wdth: 0, wght: 1000 },
      makeContour([{ x: 100, y: 0 }]),
      500,
    );
    const lw = makeMaster(
      "LightWide",
      { wdth: 1000, wght: 0 },
      makeContour([{ x: 0, y: 100 }]),
      600,
    );
    const bw = makeMaster(
      "BoldWide",
      { wdth: 1000, wght: 1000 },
      makeContour([{ x: 100, y: 100 }]),
      700,
    );

    const result = interpolateGlyph([lc, bc, lw, bw], [wdthAxis, wghtAxis], {
      wdth: 500,
      wght: 500,
    });

    expect(result).not.toBeNull();
    expect(result!.contours[0].points[0].x).toBeCloseTo(50);
    expect(result!.contours[0].points[0].y).toBeCloseTo(50);
    expect(result!.xAdvance).toBeCloseTo(550);
  });

  it("deduplicates masters at the same normalized location", () => {
    const m1 = makeMaster("Sans", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const m2 = makeMaster("Slab", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const m3 = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const result = interpolateGlyph([m1, m2, m3], axes, { wght: 500 });

    expect(result).not.toBeNull();
    expect(result!.contours[0].points[0].x).toBeCloseTo(150);
  });

  it("filters incompatible masters and interpolates with default-compatible set", () => {
    // Default (A at wght=0) is compatible with B, but C has extra contour
    const defaultMaster = makeMaster("A", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const compatible = makeMaster("B", { wght: 1000 }, makeContour([{ x: 200, y: 0 }]), 700);
    const incompatible: MasterSnapshot = {
      sourceId: "C",
      sourceName: "C",
      location: { values: { wght: 500 } },
      snapshot: makeSnapshot(
        [makeContour([{ x: 100, y: 0 }]), makeContour([{ x: 50, y: 50 }])],
        600,
      ),
    };

    const result = interpolateGlyph(
      [defaultMaster, incompatible, compatible],
      axes,
      { wght: 500 },
    );

    expect(result).not.toBeNull();
    expect(result!.contours[0].points[0].x).toBeCloseTo(100);
  });

  it("returns default snapshot when default master is incompatible with others", () => {
    // Default (wght=0) has extra contour — no compatible group includes the default
    const defaultMaster: MasterSnapshot = {
      sourceId: "Default",
      sourceName: "Default",
      location: { values: { wght: 0 } },
      snapshot: makeSnapshot(
        [makeContour([{ x: 0, y: 0 }]), makeContour([{ x: 50, y: 50 }])],
        500,
      ),
    };
    const mid = makeMaster("Mid", { wght: 500 }, makeContour([{ x: 100, y: 0 }]), 600);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 0 }]), 700);

    const result = interpolateGlyph([defaultMaster, mid, bold], axes, { wght: 750 });

    // Default is the reference but incompatible with others → only default remains
    expect(result).toBe(defaultMaster.snapshot);
  });

  it("returns default snapshot when all masters are incompatible with each other", () => {
    const m1 = makeMaster("A", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const m2: MasterSnapshot = {
      sourceId: "B",
      sourceName: "B",
      location: { values: { wght: 1000 } },
      snapshot: makeSnapshot(
        [makeContour([{ x: 200, y: 0 }]), makeContour([{ x: 100, y: 100 }])],
        700,
      ),
    };

    const result = interpolateGlyph([m1, m2], axes, { wght: 500 });

    // Falls back to first master since no compatible group
    expect(result).toBe(m1.snapshot);
  });
});
