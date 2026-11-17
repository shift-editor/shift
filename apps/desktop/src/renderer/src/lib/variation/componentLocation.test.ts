import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";
import { selectedComponentLocationCell, setSelectedComponentAxis } from "./componentLocation";

// MutatorSans's `Aacute` is `A` plus `acute`. Its default source is
// LightCondensed (weight 0, width 0); BoldCondensed is weight 1000.
const editor = useTestEditor({ file: FONTS.mutatorSans, glyph: "Aacute" });

/** What the Designspace tab's component section shows, by axis name. */
function shown() {
  const location = selectedComponentLocationCell(editor.asEditor()).peek();
  if (!location) return null;

  return {
    title: location.title,
    set: location.set.map(({ axis, value }) => [axis.name, value]),
    followed: location.followed.map(({ axis, follows }) => [axis.name, follows]),
  };
}

/**
 * Selects `Aacute`'s components by clicking them on the canvas, as a user
 * does: `A` on its left foot, `acute` in its middle, Shift adding each after the first.
 */
async function selectComponents(...names: string[]) {
  const { components } = await editor.drawnGlyph("Aacute");
  for (const [index, name] of names.entries()) {
    const bounds = components.find((component) => component.glyph === name)!.bounds!;
    const at =
      name === "A"
        ? { x: bounds.min.x + 15, y: bounds.min.y + 15 }
        : { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 };
    await editor.clickAt(at, index === 0 ? undefined : { shiftKey: true });
  }
}

function axisNamed(tag: string) {
  return editor.axis({ tag })!.id;
}

describe("the component section of the Designspace tab", () => {
  it("shows nothing until components are selected", () => {
    expect(shown()).toBeNull();
  });

  it("titles a selected component by its base glyph and lists what it follows", async () => {
    await selectComponents("A");

    expect(shown()).toEqual({
      title: "A",
      set: [],
      followed: [
        ["width", 0],
        ["weight", 0],
      ],
    });
  });

  it("gives an axis the component sets a row with its value, in user units", async () => {
    await selectComponents("A");
    await setSelectedComponentAxis(editor.asEditor(), axisNamed("wght"), 1000);

    expect(shown()).toEqual({ title: "A", set: [["weight", 1000]], followed: [["width", 0]] });
  });

  it("says Mixed, with no value, when the selected components differ", async () => {
    await selectComponents("A");
    await setSelectedComponentAxis(editor.asEditor(), axisNamed("wght"), 1000);
    await selectComponents("A", "acute");

    expect(shown()).toEqual({
      title: "2 components",
      set: [["weight", null]],
      followed: [["width", 0]],
    });
  });

  it("keeps each source's own rows", async () => {
    await selectComponents("A");
    await setSelectedComponentAxis(editor.asEditor(), axisNamed("wght"), 1000);

    await editor.editSources(["BoldCondensed"]);
    await selectComponents("A");

    expect(shown()?.set).toEqual([]);
  });

  it("sets an axis at a source other than the default", async () => {
    // The canvas draws the default source's components, so the selection
    // names those; the edit still lands on BoldCondensed's own component.
    await editor.editSources(["BoldCondensed"]);
    await selectComponents("A");
    await setSelectedComponentAxis(editor.asEditor(), axisNamed("wght"), 0);

    expect(shown()?.set).toEqual([["weight", 0]]);
  });

  it("hides between sources, where there is nothing to edit", async () => {
    await selectComponents("A");
    editor.setLocation({ wght: 500, wdth: 0 });

    expect(shown()).toBeNull();
  });
});
