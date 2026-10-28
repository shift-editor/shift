import { describe, expect, it } from "vitest";
import {
  asAxisId,
  asAxisMappingId,
  type Axis,
  type AxisMapping,
  type AxisMappingBasis,
} from "@shift/types";
import { between, expectNumbersClose, REFERENCE_SEED, seededRandom } from "../../testing/reference";
import { axisValue, externalAxisLocationFromRecord } from "./location";
import { externalAxisLocationForDesignLocation, mapAxisLocation } from "../wasm/variation";
import { compileAxisMappings, mapLocation } from "@shift/wasm/reference";
import type {
  CoordinateSpacesRemainDistinct,
  MappingAcceptsExternalLocation,
  MappingReturnsDesignLocation,
} from "./location.test-d";

const coordinateSpaceContract: readonly [
  MappingAcceptsExternalLocation,
  MappingReturnsDesignLocation,
  CoordinateSpacesRemainDistinct,
] = [true, true, true];
void coordinateSpaceContract;

function axis(id: string, tag: string, range: [number, number, number], role: Axis["role"]): Axis {
  const [minimum, defaultValue, maximum] = range;
  return {
    id: asAxisId(id),
    tag,
    name: tag,
    role,
    axisType: "continuous",
    minimum,
    default: defaultValue,
    maximum,
    labels: [],
    hidden: false,
  };
}

const weight = axis("axis_weight", "wght", [100, 400, 900], "external");
const width = axis("axis_width", "wdth", [50, 100, 200], "external");
const optical = axis("axis_optical", "opsz", [8, 12, 72], "internal");
const axes = [weight, width, optical];

type Values = Readonly<Record<string, number>>;

function mapping(
  id: string,
  inputs: readonly Axis[],
  outputs: readonly Axis[],
  points: readonly (readonly [Values, Values])[],
): AxisMapping {
  return {
    id: asAxisMappingId(id),
    name: id,
    inputs: inputs.map((input) => input.id),
    outputs: outputs.map((output) => output.id),
    points: points.map(([input, output]) => ({
      input: { values: input },
      output: { values: output },
    })),
  };
}

const weightCurve = mapping(
  "axisMapping_weight",
  [weight],
  [weight],
  [
    [{ [weight.id]: 100 }, { [weight.id]: 100 }],
    [{ [weight.id]: 400 }, { [weight.id]: 400 }],
    [{ [weight.id]: 900 }, { [weight.id]: 800 }],
  ],
);
const reversed = mapping(
  "axisMapping_reversed",
  [weight],
  [weight],
  [
    [{ [weight.id]: 100 }, { [weight.id]: 900 }],
    [{ [weight.id]: 900 }, { [weight.id]: 100 }],
  ],
);
const opticalCompensation = mapping(
  "axisMapping_optical",
  [weight, width],
  [optical],
  [[{ [weight.id]: 800, [width.id]: 125 }, { [optical.id]: 72 }]],
);

/** The mappings as the bridge sends them: compiled by shift-font. */
function compiled(mappings: readonly AxisMapping[]): AxisMappingBasis[] {
  return compileAxisMappings(axes, [...mappings]).map((basis) => ({
    ...basis,
    mappingId: asAxisMappingId(basis.mappingId),
    inputAxisIds: basis.inputAxisIds.map(asAxisId),
    outputAxisIds: basis.outputAxisIds.map(asAxisId),
    basis: {
      deltas: basis.basis.deltas.map((delta) => ({
        region: delta.region.map((support) => ({ ...support, axisId: asAxisId(support.axisId) })),
        values: new Float64Array(delta.values),
      })),
    },
  }));
}

interface MappingCase {
  readonly name: string;
  readonly mappings: readonly AxisMapping[];
  readonly location: Values;
}

const mappingSets: readonly (readonly [string, readonly AxisMapping[]])[] = [
  ["independent", [weightCurve]],
  ["reversed", [reversed]],
  ["cross-axis", [weightCurve, opticalCompensation]],
];

function mappingCases(sweep = 60): MappingCase[] {
  const random = seededRandom(REFERENCE_SEED + 4);
  return mappingSets.flatMap(([name, mappings]) =>
    Array.from({ length: sweep }, (_, index) => ({
      name: `${name} ${index}`,
      mappings,
      location: {
        [weight.id]: between(random, weight.minimum!, weight.maximum!),
        [width.id]: between(random, width.minimum!, width.maximum!),
      },
    })),
  );
}

describe("external axis locations use Rust-compiled mapping bases", () => {
  it.each([
    { mappings: [weightCurve], location: { [weight.id]: 650 }, expected: { [weight.id]: 600 } },
    { mappings: [reversed], location: { [weight.id]: 250 }, expected: { [weight.id]: 650 } },
    {
      mappings: [weightCurve, opticalCompensation],
      location: { [weight.id]: 900, [width.id]: 125 },
      expected: { [weight.id]: 800, [optical.id]: 72 },
    },
  ])("maps $location as Fontdrasil does", ({ mappings, location, expected }) => {
    const mapped = mapAxisLocation(
      externalAxisLocationFromRecord(location),
      axes,
      compiled(mappings),
    );

    for (const [axisId, value] of Object.entries(expected)) {
      expect(mapped.get(asAxisId(axisId))).toBeCloseTo(value, 9);
    }
  });

  it.each(mappingCases())("maps $name like shift-font's map_location", (mappingCase) => {
    const external = externalAxisLocationFromRecord(mappingCase.location);
    const mapped = mapAxisLocation(external, axes, compiled(mappingCase.mappings));
    const expected = new Map(
      mapLocation(axes, [...mappingCase.mappings], mappingCase.location).map(
        ({ axisId, value }) => [axisId, value],
      ),
    );

    expectNumbersClose(
      axes.map((candidate) => axisValue(mapped, candidate)),
      axes.map((candidate) => expected.get(candidate.id) ?? candidate.default),
      mappingCase,
      { labels: axes.map((candidate) => candidate.tag) },
    );
  });

  it.each(mappingCases(10))("recovers the external controls of $name", (mappingCase) => {
    const bases = compiled(mappingCase.mappings);
    const external = externalAxisLocationFromRecord(mappingCase.location);
    const design = mapAxisLocation(external, axes, bases);
    const recovered = externalAxisLocationForDesignLocation(design, axes, bases);
    const controls = axes.filter((candidate) => candidate.role === "external");

    expectNumbersClose(
      controls.map((control) => axisValue(recovered, control)),
      controls.map((control) => axisValue(external, control)),
      mappingCase,
      { labels: controls.map((control) => control.tag) },
    );
  });
});
