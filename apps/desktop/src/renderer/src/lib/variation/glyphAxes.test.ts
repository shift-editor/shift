import { describe, expect, it } from "vitest";
import type { LayerId } from "@shift/types";
import { FONTS, useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import {
  addGlyphAxis,
  addGlyphSourceHere,
  canAddGlyphSourceCell,
  deleteGlyphSource,
  glyphAxesCell,
  glyphSourcesCell,
  selectGlyphSource,
  setGlyphAxis,
} from "./glyphAxes";

// Solenoid: a Bleed axis (Bled at 100). `dot` is a 100 × 100 square at
// Regular, 300 wide at Spread 100 and 300 tall at Strike 100 (both its own
// axes, 0–100). `H` has no axes of its own and a drawing at Bleed 50.
const editor = useTestEditor({ file: FONTS.solenoid, glyph: "dot" });

/** What the Glyph axes section shows, by axis name. */
function glyphAxes() {
  const section = glyphAxesCell(editor.asEditor()).peek();
  if (!section) return null;

  return {
    glyph: section.glyphName,
    rows: section.rows.map(({ axis, value }) => [axis.name, value]),
  };
}

/** What the Glyph sources section lists; null when it is not shown. */
function glyphSources() {
  const rows = glyphSourcesCell(editor.asEditor()).peek();
  return rows?.map(({ name, active }) => ({ name, active })) ?? null;
}

/** The layer of the glyph source the Glyph sources section names `name`. */
function glyphSourceNamed(name: string): LayerId {
  const row = glyphSourcesCell(editor.asEditor())
    .peek()
    // oxlint-disable-next-line shift/no-lookup-in-tests -- rows are named by location, the UI's only handle on them
    ?.find((source) => source.name === name);
  if (!row) throw new Error(`no glyph source named ${name}`);
  return row.layerId;
}

function axisId(tag: string) {
  const section = glyphAxesCell(editor.asEditor()).peek();
  // oxlint-disable-next-line shift/no-lookup-in-tests -- the section lists the glyph's own axes, which the axis selector does not read
  const row = section?.rows.find(({ axis }) => axis.tag === tag);
  if (!row) throw new Error(`no glyph axis ${tag}`);
  return row.axis.id;
}

async function drawnWidth(surface: EditorTestSurface = editor): Promise<number | null> {
  const { bounds } = await surface.drawnGlyph();
  return bounds ? bounds.max.x - bounds.min.x : null;
}

describe("a glyph with sources of its own", () => {
  it("opens and draws its default source", async () => {
    expect(await editor.drawnGlyph()).toMatchObject({
      bounds: { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
    });
  });

  it("draws a glyph source between the font's sources", async () => {
    await editor.openGlyph("H");
    editor.setLocation({ BLED: 50 });

    // The Bleed 50 drawing sets its first dot to Spread 80: 280 wide at Bleed 50.
    expect(await editor.drawnGlyph()).toMatchObject({
      components: [
        { glyph: "dot", bounds: { min: { x: -10 }, max: { x: 270 } } },
        { glyph: "dot" },
      ],
    });
  });
});

describe("the Glyph axes section", () => {
  it("lists the edited glyph's own axes at their defaults", () => {
    expect(glyphAxes()).toEqual({
      glyph: "dot",
      rows: [
        ["Spread", 0],
        ["Strike", 0],
      ],
    });
  });

  it("hides for a glyph without axes of its own", async () => {
    await editor.openGlyph("H");

    expect(glyphAxes()).toBeNull();
  });

  it("adds an axis to a glyph that has none", async () => {
    await editor.openGlyph("H");
    await addGlyphAxis(editor.asEditor(), { name: "Gap", minimum: 0, default: 0, maximum: 50 });

    expect(glyphAxes()).toEqual({ glyph: "H", rows: [["Gap", 0]] });
  });

  it("slides where the canvas draws the glyph", async () => {
    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 50);

    expect(glyphAxes()?.rows).toEqual([
      ["Spread", 50],
      ["Strike", 0],
    ]);
    expect(await drawnWidth()).toBe(200);
  });

  it("draws the glyph's own axes at their defaults again in another glyph", async () => {
    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 50);
    await editor.openGlyph("H");
    await editor.openGlyph("dot");

    expect(await drawnWidth()).toBe(100);
  });
});

describe("the Glyph sources section", () => {
  it("lists the glyph's own sources, named by where they sit", async () => {
    expect(glyphSources()).toEqual([
      { name: "Spread 100", active: false },
      { name: "Strike 100", active: false },
    ]);

    await editor.openGlyph("H");
    expect(glyphSources()).toEqual([{ name: "Bleed 50", active: false }]);
  });

  it("shows for a glyph with none, listing nothing", async () => {
    await editor.addGlyph("O", null);
    await editor.openGlyph("O");

    expect(glyphSources()).toEqual([]);
  });

  it("moves the sliders to a glyph source selected, and draws it", async () => {
    selectGlyphSource(editor.asEditor(), glyphSourceNamed("Spread 100"));

    expect(glyphSources()).toContainEqual({ name: "Spread 100", active: true });
    expect(await editor.source("active")).toBeNull();
    expect(glyphAxes()?.rows).toEqual([
      ["Spread", 100],
      ["Strike", 0],
    ]);
    expect(await drawnWidth()).toBe(300);
  });

  it("edits the selected glyph source and no other", async () => {
    selectGlyphSource(editor.asEditor(), glyphSourceNamed("Spread 100"));
    editor.selectTool("select");
    editor.selectAll();
    await editor.pressKey("ArrowRight", { shiftKey: true });

    expect(await editor.drawnGlyph()).toMatchObject({ bounds: { min: { x: 10 } } });
    await editor.editSources(["Regular"]);
    expect(await editor.drawnGlyph()).toMatchObject({ bounds: { min: { x: 0 } } });
  });
});

describe("adding a glyph source where the sliders sit", () => {
  it("is offered only where the glyph has no source or glyph source", () => {
    expect(canAddGlyphSourceCell(editor.asEditor()).peek()).toBe(false);

    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 60);
    expect(canAddGlyphSourceCell(editor.asEditor()).peek()).toBe(true);

    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 100);
    expect(canAddGlyphSourceCell(editor.asEditor()).peek()).toBe(false);
  });

  it("adds one there from the outline shown, and edits it", async () => {
    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 60);
    await addGlyphSourceHere(editor.asEditor());

    expect(glyphSources()).toContainEqual({ name: "Spread 60", active: true });
    expect(await drawnWidth()).toBe(220);
    expect(canAddGlyphSourceCell(editor.asEditor()).peek()).toBe(false);
  });

  it("deletes a glyph source, leaving the glyph interpolated there", async () => {
    await deleteGlyphSource(editor.asEditor(), glyphSourceNamed("Strike 100"));

    expect(glyphSources()).toEqual([{ name: "Spread 100", active: false }]);
  });
});
