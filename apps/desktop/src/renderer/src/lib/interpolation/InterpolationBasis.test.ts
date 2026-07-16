import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Axis, AxisId, InterpolationBasis, SourceId } from "@shift/types";
import { mintAxisId, mintSourceId } from "@shift/types";
import { axisLocationFromLocation } from "@/lib/variation/location";
import { interpolateSourceValues, interpolationWeights } from "./InterpolationBasis";

interface ParityMaster {
  readonly expected: number[];
}

interface ParityFixture {
  readonly expected: number[];
  readonly masters: ParityMaster[];
}

describe("InterpolationBasis", () => {
  it("evaluates source weights from a location without storing location results", () => {
    const axis = continuousAxis(mintAxisId());
    const regularId = mintSourceId();
    const boldId = mintSourceId();
    const basis = twoSourceBasis(axis.id, regularId, boldId);

    const regular = interpolationWeights(
      basis,
      axisLocationFromLocation({ values: { [axis.id]: 400 } }),
      [axis],
    );
    const halfway = interpolationWeights(
      basis,
      axisLocationFromLocation({ values: { [axis.id]: 650 } }),
      [axis],
    );
    const bold = interpolationWeights(
      basis,
      axisLocationFromLocation({ values: { [axis.id]: 900 } }),
      [axis],
    );

    expect([...regular]).toEqual([1, 0]);
    expect([...halfway]).toEqual([0.5, 0.5]);
    expect([...bold]).toEqual([0, 1]);
  });

  it("combines current source values and rejects incompatible value shapes", () => {
    const axis = continuousAxis(mintAxisId());
    const regularId = mintSourceId();
    const boldId = mintSourceId();
    const basis = twoSourceBasis(axis.id, regularId, boldId);
    const location = axisLocationFromLocation({ values: { [axis.id]: 650 } });
    const weights = interpolationWeights(basis, location, [axis]);

    const values = interpolateSourceValues(basis, weights, (sourceId) =>
      sourceId === regularId ? new Float64Array([400, 10]) : new Float64Array([900, 30]),
    );
    const incompatible = interpolateSourceValues(basis, weights, (sourceId) =>
      sourceId === regularId ? new Float64Array([400, 10]) : new Float64Array([900]),
    );

    expect(values ? [...values] : null).toEqual([650, 20]);
    expect(incompatible).toBeNull();
  });

  it("matches the Rust fontdrasil fixture across two axes", () => {
    const fixture = loadParityFixture();
    const width = continuousAxis(mintAxisId(), "wdth", 0, 0, 1000);
    const weight = continuousAxis(mintAxisId(), "wght", 0, 0, 1000);
    const sourceIds = fixture.masters.map(() => mintSourceId());
    const basis = twoAxisBasis(width.id, weight.id, sourceIds);
    const location = axisLocationFromLocation({
      values: { [width.id]: 500, [weight.id]: 500 },
    });
    const weights = interpolationWeights(basis, location, [width, weight]);
    const values = interpolateSourceValues(basis, weights, (sourceId) => {
      const sourceIndex = sourceIds.indexOf(sourceId);
      const master = fixture.masters[sourceIndex];
      return master ? new Float64Array(master.expected) : null;
    });

    expect(values).not.toBeNull();
    expect(values?.length).toBe(fixture.expected.length);
    for (let index = 0; index < fixture.expected.length; index++) {
      expect(values?.[index]).toBeCloseTo(fixture.expected[index]!, 9);
    }
  });
});

function loadParityFixture(): ParityFixture {
  const path = resolve(process.cwd(), "../../packages/types/__fixtures__/variation_parity.json");
  return JSON.parse(readFileSync(path, "utf-8")) as ParityFixture;
}

function continuousAxis(
  axisId: AxisId,
  tag = "wght",
  minimum = 100,
  defaultValue = 400,
  maximum = 900,
): Axis {
  return {
    id: axisId,
    tag,
    name: tag,
    role: "external",
    axisType: "continuous",
    minimum,
    default: defaultValue,
    maximum,
    labels: [],
    hidden: false,
  };
}

function twoSourceBasis(axisId: AxisId, regularId: SourceId, boldId: SourceId): InterpolationBasis {
  return {
    sourceIds: [regularId, boldId],
    regions: [[], [{ axisId, lower: 0, peak: 1, upper: 1 }]],
    coefficients: [new Float64Array([1, 0]), new Float64Array([-1, 1])],
  };
}

function twoAxisBasis(
  widthAxisId: AxisId,
  weightAxisId: AxisId,
  sourceIds: readonly SourceId[],
): InterpolationBasis {
  if (sourceIds.length !== 4) throw new Error("parity fixture requires four masters");

  const widthSupport = { axisId: widthAxisId, lower: 0, peak: 1, upper: 1 };
  const weightSupport = { axisId: weightAxisId, lower: 0, peak: 1, upper: 1 };
  return {
    sourceIds: [...sourceIds],
    regions: [[], [widthSupport], [weightSupport], [widthSupport, weightSupport]],
    coefficients: [
      new Float64Array([1, 0, 0, 0]),
      new Float64Array([-1, 0, 1, 0]),
      new Float64Array([-1, 1, 0, 0]),
      new Float64Array([1, -1, -1, 1]),
    ],
  };
}
