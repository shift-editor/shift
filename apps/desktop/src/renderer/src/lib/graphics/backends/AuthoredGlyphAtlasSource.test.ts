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

/** Width then weight, in MutatorSans's axis order. */
const LOCATIONS = [
  [0, 0],
  [250, 400],
  [500, 650],
  [1000, 700],
  [800, 1000],
] as const;

function buffer(): GPUBuffer {
  return { destroy() {} } as GPUBuffer;
}

function atlasOf(page: GlyphAtlasPage): SlugAtlas {
  return new SlugAtlas(page, buffer(), buffer(), page.layout.totalLength);
}

/** The page's weights evaluated statelessly from its descriptor's bases. */
function statelessWeights(page: GlyphAtlasPage, coordinates: readonly number[]): number[] {
  return Array.from(atlasOf({ ...page, weightEngine: null }).weights(coordinates));
}

function closeTo(weights: readonly number[]) {
  return weights.map((weight) => expect.closeTo(weight, 6));
}

describe("open document atlas weights", () => {
  let editor: EditorTestSurface;

  afterEach(() => editor.close());

  it("reads the same weights from the engine as from the descriptor's bases", async () => {
    editor = await openTestEditor(MUTATOR, "A");
    const page = await authoredAtlasPage(editor);
    const atlas = atlasOf(page);

    expect(page.weightEngine).not.toBeNull();
    expect(page.weightSets.length).toBeGreaterThan(1);
    for (const coordinates of LOCATIONS) {
      expect(Array.from(atlas.weights(coordinates))).toEqual(
        closeTo(statelessWeights(page, coordinates)),
      );
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
    const after = statelessWeights(await authoredAtlasPage(editor), coordinates);

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
    const after = statelessWeights(await authoredAtlasPage(editor), coordinates);

    expect(after).not.toEqual(closeTo(before));
    expect(Array.from(atlas.weights(coordinates))).toEqual(closeTo(after));
  });
});
