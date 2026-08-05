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

describe("external axis locations map synchronously", () => {
  it("evaluates an independent axis mapping", () => {
    const mapped = mapAxisLocation(new Map([[axisId, 650]]), [axis], [mapping]);

    expect(mapped.get(axisId)).toBe(600);
  });

  it("extrapolates from the nearest endpoint segment", () => {
    expect(
      mapAxisValue(150, [
        [0, 0],
        [100, 200],
      ]),
    ).toBe(300);
  });
});
