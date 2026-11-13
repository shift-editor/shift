/// <reference types="node" />
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Axis, AxisId, FontIntent, InterpolationBasis, SourceId } from "@shift/types";
import { mintAxisId, mintSourceId } from "@shift/types";
import { interpolateSourceValues } from "./InterpolationBasis";
import { newMemoryFontSource } from "../../createMemoryFontSession";
import { SessionEngine } from "../engine/SessionEngine";
import { FontVariation } from "../wasm/variation";
import { designAxisLocationFromLocation } from "../variation/location";
import { signal } from "../signals";
import type { DesignAxisLocation } from "../../types/variation";

interface ParityMaster {
  readonly expected: number[];
}

interface ParityFixture {
  readonly expected: number[];
  readonly masters: ParityMaster[];
}

/** A source of the font under test: where it sits on each axis. */
type SourcePlace = Readonly<Record<AxisId, number>>;

/** A font's sources, as a basis lists them, and how its engine weighs them. */
interface Masters {
  readonly basis: InterpolationBasis;
  weightsAt(location: DesignAxisLocation): Float64Array;
}

const engines: SessionEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

/**
 * A font with `axes` and a source at each of `places`, the first its default
 * source, opened in an engine: the basis of its sources in that order, and
 * their weights as the engine derives them from the font.
 */
async function masters(axes: readonly Axis[], places: readonly SourcePlace[]): Promise<Masters> {
  const { font } = await newMemoryFontSource({ familyName: "Masters", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  engines.push(engine);
  const [defaultSource] = engine.fontRecords().sources;
  if (!defaultSource) throw new Error("a new font starts with one source");
  const sourceIds = [defaultSource.id, ...places.slice(1).map(() => mintSourceId())];
  const intents: FontIntent[] = [
    ...axes.map((axis): FontIntent => ({ kind: "createAxis", createAxis: { axis } })),
    ...places.slice(1).map(
      (values, index): FontIntent => ({
        kind: "createSource",
        createSource: {
          sourceId: sourceIds[index + 1]!,
          name: `Master ${index}`,
          location: { values },
        },
      }),
    ),
  ];
  engine.beginEdit(null);
  engine.apply(intents);
  engine.endEdit();

  const variation = engine.variationCell.peek();
  if (!variation) throw new Error("the engine opened no variation");
  const { sources } = engine.fontRecords();
  const reader = new FontVariation(variation, {
    axesCell: signal(axes),
    mappingBasesCell: signal([]),
    sourcesCell: signal(sources),
  });
  // Only the sources cross: the engine derives the basis from its own font.
  const basis: InterpolationBasis = {
    sourceIds,
    designNormalization: [],
    basis: { deltas: [] },
  };
  return {
    basis,
    weightsAt(location) {
      const weights = reader.interpolationWeights(reader.sourceSet(basis), location);
      if (!weights) throw new Error("the font's sources form no model");
      return weights;
    },
  };
}

describe("InterpolationBasis", () => {
  it("evaluates source weights from a location without storing location results", async () => {
    const axis = continuousAxis(mintAxisId());
    const { weightsAt } = await masters([axis], [{ [axis.id]: 400 }, { [axis.id]: 900 }]);
    const at = (value: number) => designAxisLocationFromLocation({ values: { [axis.id]: value } });

    expect([...weightsAt(at(400))]).toEqual([1, 0]);
    expect([...weightsAt(at(650))]).toEqual([0.5, 0.5]);
    expect([...weightsAt(at(900))]).toEqual([0, 1]);
  });

  it("combines current source values and rejects incompatible value shapes", async () => {
    const axis = continuousAxis(mintAxisId());
    const { basis, weightsAt } = await masters([axis], [{ [axis.id]: 400 }, { [axis.id]: 900 }]);
    const [regularId] = basis.sourceIds;
    const weights = weightsAt(designAxisLocationFromLocation({ values: { [axis.id]: 650 } }));

    const values = interpolateSourceValues(basis, weights, (sourceId) =>
      sourceId === regularId ? new Float64Array([400, 10]) : new Float64Array([900, 30]),
    );
    const incompatible = interpolateSourceValues(basis, weights, (sourceId) =>
      sourceId === regularId ? new Float64Array([400, 10]) : new Float64Array([900]),
    );

    expect(values ? [...values] : null).toEqual([650, 20]);
    expect(incompatible).toBeNull();
  });

  it("matches the Rust fontdrasil fixture across two axes", async () => {
    const fixture = loadParityFixture();
    const width = continuousAxis(mintAxisId(), "wdth", 0, 0, 1000);
    const weight = continuousAxis(mintAxisId(), "wght", 0, 0, 1000);
    const corner = (wdth: number, wght: number) => ({ [width.id]: wdth, [weight.id]: wght });
    const { basis, weightsAt } = await masters(
      [width, weight],
      [corner(0, 0), corner(0, 1000), corner(1000, 0), corner(1000, 1000)],
    );
    const weights = weightsAt(
      designAxisLocationFromLocation({ values: { [width.id]: 500, [weight.id]: 500 } }),
    );
    const values = interpolateSourceValues(basis, weights, (sourceId: SourceId) => {
      const master = fixture.masters[basis.sourceIds.indexOf(sourceId)];
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
  const path = new URL("../../../../types/__fixtures__/variation_parity.json", import.meta.url);
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
    kind: { kind: "continuous", minimum, default: defaultValue, maximum },
    labels: [],
    hidden: false,
  };
}
