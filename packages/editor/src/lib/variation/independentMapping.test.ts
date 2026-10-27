import { describe, expect, it } from "vitest";
import { asAxisId, asAxisMappingId, type Axis, type AxisMapping } from "@shift/types";
import { independentMappingFor, withIndependentMapping } from "./independentMapping";

const weight: Axis = {
  id: asAxisId("axis_weight"),
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
const width = asAxisId("axis_width");

function mapping(id: string, inputs: Axis["id"][], outputs: Axis["id"][]): AxisMapping {
  return { id: asAxisMappingId(id), name: id, inputs, outputs, points: [] };
}

const crossAxis = mapping("cross", [weight.id, width], [width]);
const weightCurve = mapping("weight-curve", [weight.id], [weight.id]);

describe("independent axis mappings", () => {
  it("finds the axis's own mapping and ignores cross-axis mappings", () => {
    expect(independentMappingFor([crossAxis, weightCurve], weight)).toBe(weightCurve);
    expect(independentMappingFor([crossAxis], weight)).toBeNull();
  });

  it("replaces the axis's independent mapping even under a new id, keeping its place", () => {
    const replacement = mapping("weight-new", [weight.id], [weight.id]);

    expect(withIndependentMapping([weightCurve, crossAxis], weight, replacement)).toEqual([
      replacement,
      crossAxis,
    ]);
  });

  it("appends the mapping when the axis has none", () => {
    expect(withIndependentMapping([crossAxis], weight, weightCurve)).toEqual([
      crossAxis,
      weightCurve,
    ]);
  });
});
