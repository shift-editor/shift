import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SlugAtlas } from "@/lib/slug/SlugAtlas";
import type { EditorTestSurface } from "@/testing/surface";
import { authoredAtlasPage, openTestEditor } from "@/testing/TestEditor";
import type { GlyphAtlasPage } from "@/types/glyphAtlas";

const MUTATOR = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

function buffer(): GPUBuffer {
  return { destroy() {} } as GPUBuffer;
}

function atlasOf(page: GlyphAtlasPage): SlugAtlas {
  return new SlugAtlas(page, buffer(), buffer(), page.layout.totalLength);
}

/** The weights of an atlas page prepared now, as the font stands. */
async function freshWeights(
  editor: EditorTestSurface,
  coordinates: readonly number[],
): Promise<number[]> {
  return Array.from(atlasOf(await authoredAtlasPage(editor)).weights(coordinates));
}

function closeTo(weights: readonly number[]) {
  return weights.map((weight) => expect.closeTo(weight, 6));
}

describe("open document atlas weights", () => {
  let editor: EditorTestSurface;

  afterEach(() => editor.close());

  it("weighs each master fully at its own location, and its other sources not at all", async () => {
    editor = await openTestEditor(MUTATOR, "A");
    const page = await authoredAtlasPage(editor);
    const atlas = atlasOf(page);
    const { axes, sources } = editor.fontOverview();

    expect(page.weightSets.length).toBeGreaterThan(1);
    for (const source of sources) {
      // MutatorSans maps no axis, so a master's design location is its external one.
      const coordinates = axes.map((axis) => source.location.values[axis.id] ?? axis.kind.default);
      const weights = atlas.weights(coordinates);
      for (const set of page.weightSets) {
        const own = set.basis.sourceIds.indexOf(source.id);
        if (own === -1) continue;
        expect(set.sourceWeightIndices.map((index) => weights[index])).toEqual(
          closeTo(set.basis.sourceIds.map((_, index) => (index === own ? 1 : 0))),
        );
      }
    }
  });

  it("follows an axis mapping edit made after the atlas was prepared", async () => {
    editor = await openTestEditor(MUTATOR, "A");
    const atlas = atlasOf(await authoredAtlasPage(editor));
    const coordinates = [500, 650];
    const before = Array.from(atlas.weights(coordinates));

    await editor.setAxisMapping("wght", [
      [0, 0],
      [650, 300],
      [1000, 1000],
    ]);
    const after = await freshWeights(editor, coordinates);

    expect(after).not.toEqual(closeTo(before));
    expect(Array.from(atlas.weights(coordinates))).toEqual(closeTo(after));
  });

  it("follows a source moved after the atlas was prepared", async () => {
    editor = await openTestEditor(MUTATOR, "A");
    const atlas = atlasOf(await authoredAtlasPage(editor));
    const { axes, sources } = editor.fontOverview();
    const weight = axes.find((axis) => axis.tag === "wght");
    const width = axes.find((axis) => axis.tag === "wdth");
    if (!weight || !width) throw new Error("Expected MutatorSans's weight and width axes");
    const crossbar = sources.find(
      ({ location }) =>
        location.values[weight.id] === 700 && (location.values[width.id] ?? 0) === 0,
    );
    if (!crossbar) throw new Error("Expected the crossbar support source");
    const coordinates = [0, 600];
    const before = Array.from(atlas.weights(coordinates));

    await editor.setSourceLocation(crossbar.name, "wght", 500);
    const after = await freshWeights(editor, coordinates);

    expect(after).not.toEqual(closeTo(before));
    expect(Array.from(atlas.weights(coordinates))).toEqual(closeTo(after));
  });
});
