import { afterEach, describe, expect, it } from "vitest";
import {
  mintAxisId,
  mintAxisMappingId,
  mintSourceId,
  type Axis,
  type AxisId,
  type AxisMappingBasis,
  type FontIntent,
  type Source,
} from "@shift/types";
import { newMemoryFontSource } from "../../createMemoryFontSession";
import { SessionEngine } from "../engine/SessionEngine";
import { computed, signal } from "../signals";
import { FontVariation } from "../wasm/variation";
import { Designspace } from "./Designspace";
import { axisValue, externalAxisLocationFromRecord } from "./location";
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

function weightAxis(): Axis {
  return {
    id: mintAxisId(),
    tag: "wght",
    name: "Weight",
    role: "external",
    kind: { kind: "continuous", minimum: 100, default: 400, maximum: 900 },
    labels: [],
    hidden: false,
  };
}

function source(name: string, axis: Axis, value: number): Source {
  return {
    id: mintSourceId(),
    name,
    location: { values: { [axis.id]: value } as Record<AxisId, number> },
    metricValues: {},
    role: "master",
  };
}

/** The intent that maps external 900 to design 800 on `axis`, the default where it was. */
function compressTop(axis: Axis): FontIntent {
  const at = (value: number) => ({ values: { [axis.id]: value } });
  const point = (input: number, output: number) => ({ input: at(input), output: at(output) });
  return {
    kind: "setAxisMappings",
    setAxisMappings: {
      mappings: [
        {
          id: mintAxisMappingId(),
          name: "Weight",
          inputs: [axis.id],
          outputs: [axis.id],
          points: [point(100, 100), point(400, 400), point(900, 800)],
        },
      ],
    },
  };
}

const engines: SessionEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

/**
 * A designspace over a weight axis, its variation evaluated by an engine
 * whose font has the axis, as a font's is. `mapCompressTop` sets the font's
 * mapping through the engine, then hands the designspace its new bases, as
 * an edit's echo does.
 */
async function weightDesignspace() {
  const axis = weightAxis();
  const { font } = await newMemoryFontSource({ familyName: "Designspace", unitsPerEm: 1000 });
  const engine = await SessionEngine.open({ kind: "resident", font });
  engines.push(engine);
  const edit = (intents: readonly FontIntent[]) => {
    engine.beginEdit(null);
    engine.apply(intents);
    engine.endEdit();
  };
  edit([{ kind: "createAxis", createAxis: { axis } }]);

  const axesCell = signal([axis]);
  const mappingBasesCell = signal<readonly AxisMappingBasis[]>([]);
  const sourcesCell = signal<readonly Source[]>([]);
  const cells = { axesCell, mappingBasesCell, sourcesCell };
  const variationCell = computed(() => {
    const variation = engine.variationCell.value;
    return variation && new FontVariation(variation, cells);
  });
  return {
    axis,
    sourcesCell,
    designspace: new Designspace({ ...cells, variationCell }),
    mapCompressTop() {
      edit([compressTop(axis)]);
      mappingBasesCell.set(engine.fontHeader().axisMappingBases);
    },
  };
}

describe("Designspace", () => {
  it("maps external locations through the font's axis mappings before matching sources", async () => {
    const { axis, designspace, mapCompressTop, sourcesCell } = await weightDesignspace();
    const black = source("Black", axis, 800);
    sourcesCell.set([black]);
    mapCompressTop();
    const external = externalAxisLocationFromRecord({ [axis.id]: 900 });

    expect(axisValue(designspace.toDesign(external), axis)).toBeCloseTo(800);
    expect(designspace.sourceAt(external)).toBe(black);
    expect(axisValue(designspace.toExternal(designspace.toDesign(external)), axis)).toBeCloseTo(
      900,
    );
  });

  it("finds exact, nearest, and identified sources", async () => {
    const { axis, designspace, sourcesCell } = await weightDesignspace();
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

  it("finds a source by exact name, and refuses a name two sources share", async () => {
    const { axis, designspace, sourcesCell } = await weightDesignspace();
    const light = source("Light", axis, 100);
    sourcesCell.set([light, source("Bold", axis, 700), source("Bold", axis, 800)]);

    expect(designspace.sourceNamed("Light")).toBe(light);
    expect(designspace.sourceNamed("light")).toBeNull();
    expect(() => designspace.sourceNamed("Bold")).toThrow("Source name Bold is ambiguous");
  });

  it("keeps reactive readers current when sources or mappings change", async () => {
    const { axis, designspace, mapCompressTop, sourcesCell } = await weightDesignspace();
    const external = externalAxisLocationFromRecord({ [axis.id]: 900 });
    const exact = computed(() => designspace.sourceAt(external)?.name ?? null);
    const black = source("Black", axis, 800);

    expect(exact.value).toBeNull();
    sourcesCell.set([black]);
    expect(exact.value).toBeNull();
    mapCompressTop();
    expect(exact.value).toBe("Black");
    exact.dispose();
  });

  it("builds locations from explicit coordinates and lists them on every axis", async () => {
    const { axis, designspace, mapCompressTop } = await weightDesignspace();
    mapCompressTop();

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
