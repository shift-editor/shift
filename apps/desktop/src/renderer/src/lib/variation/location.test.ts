import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Axis, AxisMappingBasis } from "@shift/types";
import { externalAxisLocationFromRecord, mapAxisLocation } from "./location";
import type {
  CoordinateSpacesRemainDistinct,
  MappingAcceptsExternalLocation,
  MappingReturnsDesignLocation,
} from "./location.typecheck";

const coordinateSpaceContract: readonly [
  MappingAcceptsExternalLocation,
  MappingReturnsDesignLocation,
  CoordinateSpacesRemainDistinct,
] = [true, true, true];
void coordinateSpaceContract;

interface MappingCase {
  readonly basisIds: string[];
  readonly location: Record<string, number>;
  readonly expected: Record<string, number>;
}

interface MappingFixture {
  readonly axes: Axis[];
  readonly bases: AxisMappingBasis[];
  readonly cases: MappingCase[];
}

describe("external axis locations use Rust-compiled mapping bases", () => {
  it("matches Fontdrasil for independent, reversed, and cross-axis mappings", () => {
    const fixture = loadMappingFixture();

    for (const mappingCase of fixture.cases) {
      const bases = fixture.bases.filter((basis) => mappingCase.basisIds.includes(basis.mappingId));
      const mapped = mapAxisLocation(
        externalAxisLocationFromRecord(mappingCase.location),
        fixture.axes,
        bases,
      );

      for (const [axisId, expected] of Object.entries(mappingCase.expected)) {
        expect(mapped.get(axisId as Axis["id"])).toBeCloseTo(expected, 9);
      }
    }
  });
});

function loadMappingFixture(): MappingFixture {
  const path = resolve(process.cwd(), "../../packages/types/__fixtures__/axis_mapping_basis.json");
  const fixture = JSON.parse(readFileSync(path, "utf-8")) as MappingFixture;

  return {
    ...fixture,
    bases: fixture.bases.map((mapping) => ({
      ...mapping,
      basis: {
        deltas: mapping.basis.deltas.map((delta) => ({
          ...delta,
          values: new Float64Array(delta.values),
        })),
      },
    })),
  };
}
