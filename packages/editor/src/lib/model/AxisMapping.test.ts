import { describe, expect, it } from "vitest";
import { asAxisId, type AxisKind } from "@shift/types";
import { Axis } from "./Axis";
import { AxisMapping } from "./AxisMapping";

function axis(kind: AxisKind): Axis {
  return new Axis({
    id: asAxisId("axis_wght"),
    tag: "wght",
    name: "Weight",
    role: "external",
    kind,
    labels: [],
    hidden: false,
  });
}

const weight = axis({ kind: "continuous", minimum: 100, default: 400, maximum: 900 });
const italic = axis({ kind: "discrete", values: [0, 0.5, 1], default: 0 });

function inputs(mapping: AxisMapping): number[] {
  return mapping.coordinates.map(({ input }) => input);
}

describe("an independent axis mapping", () => {
  it("starts as identity over a range's bounds and default", () => {
    const identity = AxisMapping.identity(weight);

    expect(identity.record).toMatchObject({
      name: "Weight mapping",
      inputs: [weight.id],
      outputs: [weight.id],
    });
    expect(identity.coordinates).toEqual([
      { index: 0, input: 100, output: 100 },
      { index: 1, input: 400, output: 400 },
      { index: 2, input: 900, output: 900 },
    ]);
  });

  it("starts as identity over a discrete axis's values", () => {
    expect(inputs(AxisMapping.identity(italic))).toEqual([0, 0.5, 1]);
  });

  it("moves one point's input, output or both", () => {
    const identity = AxisMapping.identity(weight);
    const outputMoved = new AxisMapping(identity.withPointOutput(2, 800), weight);
    const inputMoved = new AxisMapping(outputMoved.withPointInput(0, 200), weight);

    expect(new AxisMapping(inputMoved.withPoint(1, 450, 500), weight).coordinates).toEqual([
      { index: 0, input: 200, output: 100 },
      { index: 1, input: 450, output: 500 },
      { index: 2, input: 900, output: 800 },
    ]);
  });

  it("removes one point", () => {
    const identity = AxisMapping.identity(weight);

    expect(inputs(new AxisMapping(identity.withoutPoint(1), weight))).toEqual([100, 900]);
  });

  it("adds the midpoint of the widest gap, on the curve, in input order", () => {
    const compressed = new AxisMapping(
      AxisMapping.identity(weight).withPointOutput(2, 800),
      weight,
    );
    const added = new AxisMapping(compressed.withNextPoint(), weight);

    expect(added.coordinates).toEqual([
      { index: 0, input: 100, output: 100 },
      { index: 1, input: 400, output: 400 },
      { index: 2, input: 650, output: 600 },
      { index: 3, input: 900, output: 800 },
    ]);
  });

  it("adds a discrete axis's first unmapped value, and nothing once all are mapped", () => {
    const partial = new AxisMapping(AxisMapping.identity(italic).withoutPoint(1), italic);

    expect(partial.nextPoint()).toEqual({
      input: { values: { [italic.id]: 0.5 } },
      output: { values: { [italic.id]: 0.5 } },
    });
    const complete = AxisMapping.identity(italic);
    expect(complete.nextPoint()).toBeNull();
    expect(complete.withNextPoint()).toBe(complete.record);
  });
});
