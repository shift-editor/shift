import { asAxisId, type Axis } from "@shift/types";
import { describe, expect, it } from "vitest";
import { axisVaries } from "./axis";

const pointAxis: Axis = {
  id: asAxisId("axis_width"),
  tag: "wdth",
  name: "Width",
  role: "external",
  axisType: "continuous",
  minimum: 100,
  default: 100,
  maximum: 100,
  labels: [],
  hidden: false,
};

const variableAxis: Axis = {
  ...pointAxis,
  id: asAxisId("axis_weight"),
  tag: "wght",
  name: "Weight",
  minimum: 300,
  default: 400,
  maximum: 900,
};

describe("variation axis controls", () => {
  it("omit a point axis", () => {
    expect(axisVaries(pointAxis)).toBe(false);
  });

  it("retain an axis with a usable range", () => {
    expect(axisVaries(variableAxis)).toBe(true);
  });
});
