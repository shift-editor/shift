import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// MutatorSans's `Aacute` is `A` plus `acute`. Its default source is
// LightCondensed (weight 0, width 0); BoldCondensed is weight 1000.
const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "Aacute" });
const MASTERS = ["LightCondensed", "BoldCondensed", "LightWide", "BoldWide"];

/** `A` as the canvas draws it on its own at weight `weight`, width 0. */
async function aAtWeight(weight: number) {
  editor.setLocation({ wght: weight, wdth: 0 });
  const bounds = (await editor.drawnGlyph("A")).bounds;
  editor.setLocation({ wght: 0, wdth: 0 });
  return bounds;
}

/** `Aacute`'s `A` component, its first, as the canvas draws it. */
async function drawnA() {
  const [a] = (await editor.drawnGlyph("Aacute")).components;
  expect(a?.glyph).toBe("A");
  return a!;
}

async function selectA() {
  const [a] = await editor.components();
  editor.selectObjects([a!.id]);
}

describe("a component that sets an axis draws its base glyph there", () => {
  it("draws A bold inside the light Aacute, and follows the glyph again when reset", async () => {
    const bold = await aAtWeight(1000);
    const light = (await drawnA()).bounds;
    const weight = editor.axis({ tag: "wght" })!;
    await selectA();

    expect(await editor.setSelectedComponentsAxis(weight.id, 1000)).toBe(true);
    expect((await drawnA()).bounds).toEqual(bold);

    expect(await editor.setSelectedComponentsAxis(weight.id, null)).toBe(true);
    expect((await drawnA()).bounds).toEqual(light);
  });

  it("undoes setting the axis in one step", async () => {
    const light = (await drawnA()).bounds;
    const weight = editor.axis({ tag: "wght" })!;
    await selectA();
    await editor.setSelectedComponentsAxis(weight.id, 1000);

    await editor.undo();
    await editor.settle();

    expect((await drawnA()).bounds).toEqual(light);
  });

  it("draws A at the font's default location when it uses the font's location", async () => {
    const light = (await drawnA()).bounds;
    await editor.editSources(MASTERS);
    await selectA();
    expect(await editor.setSelectedComponentsInheritance("font")).toBe(true);

    // On the bold master, Aacute's A stays at the font's default: light.
    editor.setLocation({ wght: 1000, wdth: 0 });

    expect((await drawnA()).bounds).toEqual(light);
  });

  it("keeps an axis set on every master between masters, as the glyph moves", async () => {
    const bold = await aAtWeight(1000);
    const weight = editor.axis({ tag: "wght" })!;
    await editor.editSources(MASTERS);
    await selectA();
    await editor.setSelectedComponentsAxis(weight.id, 1000);

    editor.setLocation({ wght: 500, wdth: 0 });

    expect((await drawnA()).bounds).toEqual(bold);
  });
});
