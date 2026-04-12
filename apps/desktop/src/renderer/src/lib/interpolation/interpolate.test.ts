import { describe, it, expect } from "vitest";
import {
  interpolateGlyph,
  normalizeAxisValue,
  checkCompatibility,
  type MasterSnapshot,
  type InterpolationResult,
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

/** Unwrap a non-null InterpolationResult */
function unwrap(result: InterpolationResult | null): InterpolationResult {
  expect(result).not.toBeNull();
  return result!;
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
    const result = unwrap(interpolateGlyph([master], axes, { wght: 0 }));
    expect(result.instance).toBe(master.snapshot);
    expect(result.errors).toHaveLength(0);
  });

  it("interpolates at midpoint between two masters", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const { instance } = unwrap(interpolateGlyph([light, bold], axes, { wght: 500 }));

    expect(instance.contours[0].points[0].x).toBeCloseTo(150);
    expect(instance.contours[0].points[0].y).toBeCloseTo(300);
    expect(instance.xAdvance).toBeCloseTo(600);
  });

  it("returns default master at default location", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const { instance } = unwrap(interpolateGlyph([light, bold], axes, { wght: 0 }));

    expect(instance.contours[0].points[0].x).toBeCloseTo(100);
    expect(instance.contours[0].points[0].y).toBeCloseTo(200);
  });

  it("returns non-default master at its location", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const { instance } = unwrap(interpolateGlyph([light, bold], axes, { wght: 1000 }));

    expect(instance.contours[0].points[0].x).toBeCloseTo(200);
    expect(instance.contours[0].points[0].y).toBeCloseTo(400);
  });

  it("preserves point metadata from reference master", () => {
    const light = makeMaster("Light", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const bold = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const { instance } = unwrap(interpolateGlyph([light, bold], axes, { wght: 500 }));

    expect(instance.contours[0].points[0].id).toBe(light.snapshot.contours[0].points[0].id);
    expect(instance.contours[0].points[0].pointType).toBe("onCurve");
    expect(instance.contours[0].id).toBe(light.snapshot.contours[0].id);
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

    const { instance, errors } = unwrap(
      interpolateGlyph([lc, bc, lw, bw], [wdthAxis, wghtAxis], { wdth: 500, wght: 500 }),
    );

    expect(errors).toHaveLength(0);
    expect(instance.contours[0].points[0].x).toBeCloseTo(50);
    expect(instance.contours[0].points[0].y).toBeCloseTo(50);
    expect(instance.xAdvance).toBeCloseTo(550);
  });

  it("deduplicates masters at the same normalized location", () => {
    const m1 = makeMaster("Sans", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const m2 = makeMaster("Slab", { wght: 0 }, makeContour([{ x: 100, y: 200 }]), 500);
    const m3 = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 400 }]), 700);

    const { instance } = unwrap(interpolateGlyph([m1, m2, m3], axes, { wght: 500 }));

    expect(instance.contours[0].points[0].x).toBeCloseTo(150);
  });
});

describe("interpolateGlyph — incompatible sources", () => {
  const axes = [makeAxis()];

  it("reports incompatible source and still produces a result", () => {
    const defaultMaster = makeMaster("Default", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const compatible = makeMaster("Bold", { wght: 1000 }, makeContour([{ x: 200, y: 0 }]), 700);
    const incompatible: MasterSnapshot = {
      sourceId: "Bad",
      sourceName: "Bad",
      location: { values: { wght: 500 } },
      snapshot: makeSnapshot(
        [makeContour([{ x: 100, y: 0 }]), makeContour([{ x: 50, y: 50 }])],
        600,
      ),
    };

    const { instance, errors } = unwrap(
      interpolateGlyph([defaultMaster, incompatible, compatible], axes, { wght: 1000 }),
    );

    // Incompatible source reported in errors
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].sourceName).toBe("Bad");

    // At wght=1000 (bold's exact location), result should match bold
    expect(instance.contours[0].points[0].x).toBeCloseTo(200);
  });

  it("returns default when only one compatible source", () => {
    const defaultMaster = makeMaster("Default", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const incompat: MasterSnapshot = {
      sourceId: "Bad",
      sourceName: "Bad",
      location: { values: { wght: 1000 } },
      snapshot: makeSnapshot([makeContour([{ x: 0, y: 0 }]), makeContour([{ x: 50, y: 50 }])], 700),
    };

    const { instance, errors } = unwrap(
      interpolateGlyph([defaultMaster, incompat], axes, { wght: 500 }),
    );

    // Incompatible source zeroed out — result is just the default
    expect(errors.length).toBeGreaterThan(0);
    expect(instance.contours[0].points[0].x).toBeCloseTo(0);
  });

  it("handles all sources incompatible except default", () => {
    const defaultMaster = makeMaster("Default", { wght: 0 }, makeContour([{ x: 10, y: 20 }]), 500);
    const bad1: MasterSnapshot = {
      sourceId: "Bad1",
      sourceName: "Bad1",
      location: { values: { wght: 500 } },
      snapshot: makeSnapshot([makeContour([{ x: 0, y: 0 }]), makeContour([{ x: 50, y: 50 }])], 600),
    };
    const bad2: MasterSnapshot = {
      sourceId: "Bad2",
      sourceName: "Bad2",
      location: { values: { wght: 1000 } },
      snapshot: makeSnapshot(
        [
          makeContour([{ x: 0, y: 0 }]),
          makeContour([{ x: 50, y: 50 }]),
          makeContour([{ x: 99, y: 99 }]),
        ],
        700,
      ),
    };

    const { instance, errors } = unwrap(
      interpolateGlyph([defaultMaster, bad1, bad2], axes, { wght: 500 }),
    );

    expect(errors).toHaveLength(2);
    // Result is the default since both other deltas are zeroed
    expect(instance.contours[0].points[0].x).toBeCloseTo(10);
    expect(instance.contours[0].points[0].y).toBeCloseTo(20);
  });

  it("errors include the source name and a message", () => {
    const defaultMaster = makeMaster("Default", { wght: 0 }, makeContour([{ x: 0, y: 0 }]), 500);
    const incompat: MasterSnapshot = {
      sourceId: "Wonky",
      sourceName: "Wonky",
      location: { values: { wght: 1000 } },
      snapshot: makeSnapshot([makeContour([{ x: 0, y: 0 }]), makeContour([{ x: 50, y: 50 }])], 700),
    };

    const { errors } = unwrap(interpolateGlyph([defaultMaster, incompat], axes, { wght: 500 }));

    expect(errors).toHaveLength(1);
    expect(errors[0].sourceName).toBe("Wonky");
    expect(errors[0].message).toContain("contour count");
  });
});
