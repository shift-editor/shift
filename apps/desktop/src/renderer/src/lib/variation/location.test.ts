import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  mintAxisId,
  mintAxisMappingId,
  type Axis,
  type AxisMapping,
  type AxisMappingPoint,
} from "@shift/types";
import { mapAxisLocation, mapAxisValue } from "./location";

const axisId = mintAxisId();
const axis: Axis = {
  id: axisId,
  tag: "wght",
  name: "Weight",
  role: "external",
  axisType: "continuous",
  minimum: 100,
  default: 400,
  maximum: 900,
  labels: [],
  hidden: false,
};

function point(input: number, output: number): AxisMappingPoint {
  return {
    input: { values: { [axisId]: input } },
    output: { values: { [axisId]: output } },
  };
}

const mapping: AxisMapping = {
  id: mintAxisMappingId(),
  name: "Weight mapping",
  inputs: [axisId],
  outputs: [axisId],
  points: [point(100, 100), point(400, 400), point(900, 800)],
};

function loadParityFixture(): {
  points: Array<[number, number]>;
  cases: Array<[number, number]>;
} {
  const path = resolve(process.cwd(), "../../packages/types/__fixtures__/axis_mapping_parity.txt");
  const rows = readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((line) => line.split(","))
    .map(([kind, input, output]) => [kind, Number(input), Number(output)] as const);

  return {
    points: rows.filter(([kind]) => kind === "point").map(([, input, output]) => [input, output]),
    cases: rows.filter(([kind]) => kind === "case").map(([, input, output]) => [input, output]),
  };
}

describe("external axis locations map synchronously", () => {
  it("evaluates an independent axis mapping", () => {
    const mapped = mapAxisLocation(new Map([[axisId, 650]]), [axis], [mapping]);

    expect(mapped.get(axisId)).toBe(600);
  });

  it("interpolates mapping deltas in normalized coordinates", () => {
    const reversed: AxisMapping = {
      id: mintAxisMappingId(),
      name: "Reversed weight",
      inputs: [axisId],
      outputs: [axisId],
      points: [point(100, 900), point(900, 100)],
    };

    const mapped = mapAxisLocation(new Map([[axisId, 250]]), [axis], [reversed]);

    expect(mapped.get(axisId)).toBeCloseTo(650, 9);
  });

  it("applies cross-axis mappings after independent mappings", () => {
    const widthId = mintAxisId();
    const opticalId = mintAxisId();
    const width: Axis = { ...axis, id: widthId, tag: "wdth", default: 100, maximum: 200 };
    const optical: Axis = {
      ...axis,
      id: opticalId,
      tag: "opsz",
      role: "internal",
      minimum: 8,
      default: 12,
      maximum: 72,
    };
    const cross: AxisMapping = {
      id: mintAxisMappingId(),
      name: "Optical compensation",
      inputs: [axisId, widthId],
      outputs: [opticalId],
      points: [
        {
          input: { values: { [axisId]: 800, [widthId]: 125 } },
          output: { values: { [opticalId]: 72 } },
        },
      ],
    };
    const mapped = mapAxisLocation(
      new Map([
        [axisId, 900],
        [widthId, 125],
      ]),
      [axis, width, optical],
      [mapping, cross],
    );

    expect(mapped.get(axisId)).toBeCloseTo(800, 9);
    expect(mapped.get(opticalId)).toBeCloseTo(72, 9);
  });

  it("uses Designspace offset extrapolation beyond the authored range", () => {
    expect(
      mapAxisValue(150, [
        [0, 0],
        [100, 200],
      ]),
    ).toBe(250);
  });

  it("matches the Rust axis-mapping parity fixture", () => {
    const { points, cases } = loadParityFixture();

    for (const [input, expected] of cases) {
      expect(mapAxisValue(input, points)).toBeCloseTo(expected, 9);
    }
  });
});
