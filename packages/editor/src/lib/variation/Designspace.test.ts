import { describe, expect, it } from "vitest";
import {
  mintAxisId,
  mintAxisMappingId,
  mintSourceId,
  type Axis,
  type AxisId,
  type AxisMappingBasis,
  type Source,
} from "@shift/types";
import { computed, signal } from "../signals";
import { Designspace } from "./Designspace";
import { axisValue, externalAxisLocationFromRecord } from "./location";

function weightAxis(): Axis {
  return {
    id: mintAxisId(),
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
}

function source(name: string, axis: Axis, value: number): Source {
  return {
    id: mintSourceId(),
    name,
    location: { values: { [axis.id]: value } as Record<AxisId, number> },
    metricValues: [],
  };
}

/** Maps external 900 to design 800 on `axis`. */
function compressTop(axis: Axis): AxisMappingBasis {
  return {
    mappingId: mintAxisMappingId(),
    inputAxisIds: [axis.id],
    outputAxisIds: [axis.id],
    basis: {
      deltas: [
        {
          region: [{ axisId: axis.id, lower: 0, peak: 1, upper: 1 }],
          values: Float64Array.of(-0.2),
        },
      ],
    },
  };
}

function weightDesignspace(sources: Source[], mappingBases: AxisMappingBasis[] = []) {
  const axis = weightAxis();
  const axesCell = signal([axis]);
  const mappingBasesCell = signal(mappingBases);
  const sourcesCell = signal(sources);
  return {
    axis,
    axesCell,
    mappingBasesCell,
    sourcesCell,
    designspace: new Designspace({ axesCell, mappingBasesCell, sourcesCell }),
  };
}

describe("Designspace", () => {
  it("maps external locations through the font's axis mappings before matching sources", () => {
    const { axis, designspace, mappingBasesCell, sourcesCell } = weightDesignspace([]);
    const black = source("Black", axis, 800);
    sourcesCell.set([black]);
    mappingBasesCell.set([compressTop(axis)]);
    const external = externalAxisLocationFromRecord({ [axis.id]: 900 });

    expect(axisValue(designspace.toDesign(external), axis)).toBeCloseTo(800);
    expect(designspace.sourceAt(external)).toBe(black);
    expect(axisValue(designspace.toExternal(designspace.toDesign(external)), axis)).toBeCloseTo(
      900,
    );
  });

  it("finds exact, nearest, and identified sources", () => {
    const { axis, designspace, sourcesCell } = weightDesignspace([]);
    const light = source("Light", axis, 100);
    const bold = source("Bold", axis, 700);
    sourcesCell.set([light, bold]);
    const at = (value: number) => externalAxisLocationFromRecord({ [axis.id]: value });

    expect(designspace.sourceAt(at(700))).toBe(bold);
    expect(designspace.sourceAt(at(500))).toBeNull();
    expect(designspace.nearestSource(at(500))).toBe(bold);
    expect(designspace.source(light.id)).toBe(light);
    expect(axisValue(designspace.defaultLocation(), axis)).toBe(400);
  });

  it("keeps reactive readers current when sources or mappings change", () => {
    const { axis, designspace, mappingBasesCell, sourcesCell } = weightDesignspace([]);
    const external = externalAxisLocationFromRecord({ [axis.id]: 900 });
    const exact = computed(() => designspace.sourceAt(external)?.name ?? null);
    const black = source("Black", axis, 800);

    expect(exact.value).toBeNull();
    sourcesCell.set([black]);
    expect(exact.value).toBeNull();
    mappingBasesCell.set([compressTop(axis)]);
    expect(exact.value).toBe("Black");
    exact.dispose();
  });

  it("builds locations from explicit coordinates and lists them on every axis", () => {
    const { axis, designspace, mappingBasesCell } = weightDesignspace([]);
    mappingBasesCell.set([compressTop(axis)]);

    const external = designspace.location([{ axisId: axis.id, value: 900 }]);

    expect(designspace.coordinates(external)).toEqual([{ axisId: axis.id, value: 900 }]);
    expect(designspace.coordinates(designspace.toDesign(external))[0]?.value).toBeCloseTo(800);
    expect(designspace.coordinates(designspace.location([]))).toEqual([
      { axisId: axis.id, value: 400 },
    ]);
    expect(() => designspace.location([{ axisId: mintAxisId(), value: 1 }])).toThrow(
      "Unknown axis",
    );
    expect(() =>
      designspace.location([
        { axisId: axis.id, value: 300 },
        { axisId: axis.id, value: 500 },
      ]),
    ).toThrow("Duplicate axis coordinate");
  });
});
