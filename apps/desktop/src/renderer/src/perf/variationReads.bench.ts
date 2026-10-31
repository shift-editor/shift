import { resolve } from "node:path";
import { bench, describe } from "vitest";
import type { AxisId, GlyphName, SlugWeightSet } from "@shift/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import { createWorkspaceStack } from "@/testing/workspaceStack";
import { SlugAtlas } from "@/lib/slug/SlugAtlas";
import type { GlyphAtlasPage } from "@/types/glyphAtlas";

/**
 * Per-frame variation reads on the open document, each at a new location so
 * no memo answers: one interpolated glyph's geometry while scrubbing (axis
 * mapping, source weights and the blend), a Slug atlas page's weights, and
 * one Designspace mapping. MutatorSans has four masters over two axes;
 * MappedWeight has an axis mapping. No fixture has more than a few weight
 * sets, so the many-sets page repeats MutatorSans's sets at fresh weight
 * indices to show how the cost grows with them.
 */
const OPTIONS = { time: 0, iterations: 2000, warmupTime: 0, warmupIterations: 200 };
const fonts = resolve(process.cwd(), "../../fixtures/fonts");

const mutator = createWorkspaceStack();
await mutator.openWorkspace(resolve(fonts, "mutatorsans-variable/MutatorSans.designspace"));
const glyph = await mutator.font.loadGlyph(mutator.font.recordForName("A" as GlyphName)!.id);
const axes = mutator.font.designspace.axes;
const page = await atlasPage();
const atlas = new SlugAtlas(page, buffer(), buffer(), page.layout.totalLength);
const manyPage = repeatedSets(page, 4);
const manyAtlas = new SlugAtlas(manyPage, buffer(), buffer(), manyPage.layout.totalLength);

const mapped = createWorkspaceStack();
await mapped.openWorkspace(resolve(fonts, "MappedWeight.glyphs"));
const mappedAxes = mapped.font.designspace.axes;

let step = 0;
/** A location that differs from the last one on every axis. */
function nextLocation(onAxes: readonly { id: AxisId }[]) {
  step += 1;
  const t = (step % 997) / 997;
  return externalAxisLocationFromRecord(
    Object.fromEntries(onAxes.map((axis, index) => [axis.id, 10 + 980 * ((t + index * 0.37) % 1)])),
  );
}

async function atlasPage(): Promise<GlyphAtlasPage> {
  const glyphIds = mutator.font.glyphRecords().map((record) => record.id);
  const descriptor = await mutator.editCoordinator.prepareSlugAtlasPage({
    glyphIds,
    alignment: 256,
    pageIndex: 0,
    pageCount: 1,
    replacementPageIndices: [],
  });
  return {
    generation: descriptor.generation,
    pageIndex: 0,
    bandCount: descriptor.bandCount,
    weightCount: descriptor.weightCount,
    layout: descriptor.layout,
    previewExtents: descriptor.previewExtents,
    glyphs: [],
    weightSets: descriptor.weightSets,
    weightAxes: [...axes],
    weightMappingBases: [...mutator.font.getAxisMappingBases()],
    weightEngine: mutator.editCoordinator.engine,
    resolvedWeights: null,
  };
}

/** `page` with its weight sets repeated `times`, each copy at its own weight indices. */
function repeatedSets(page: GlyphAtlasPage, times: number): GlyphAtlasPage {
  const perCopy = page.weightCount - 1;
  const weightSets: SlugWeightSet[] = [];
  for (let copy = 0; copy < times; copy += 1) {
    const offset = copy * perCopy;
    for (const set of page.weightSets) {
      weightSets.push({
        ...set,
        sourceWeightIndices: set.sourceWeightIndices.map((index) => index + offset),
      });
    }
  }
  return { ...page, weightSets, weightCount: 1 + times * perCopy };
}

function buffer(): GPUBuffer {
  return { destroy() {} } as GPUBuffer;
}

describe("variation reads per frame", () => {
  bench(
    "interpolated glyph geometry at a new location (MutatorSans A)",
    () => {
      glyph.geometryAt(nextLocation(axes));
    },
    OPTIONS,
  );

  bench(
    `atlas weights at a new location (${page.weightSets.length} weight sets)`,
    () => {
      const location = nextLocation(axes);
      atlas.weights(axes.map((axis) => location.get(axis.id) ?? 0));
    },
    OPTIONS,
  );

  bench(
    `atlas weights at a new location (${manyPage.weightSets.length} weight sets)`,
    () => {
      const location = nextLocation(axes);
      manyAtlas.weights(axes.map((axis) => location.get(axis.id) ?? 0));
    },
    OPTIONS,
  );

  bench(
    "Designspace mapping at a new location (MappedWeight)",
    () => {
      mapped.font.designspace.toDesign(nextLocation(mappedAxes));
    },
    OPTIONS,
  );
});
