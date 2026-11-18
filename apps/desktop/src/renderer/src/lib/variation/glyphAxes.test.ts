import { describe, expect, it } from "vitest";
import type { LayerId } from "@shift/types";
import { FONTS, useTestEditor } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import {
  addDrawingHere,
  addDrawingHereCell,
  addGlyphAxis,
  deleteDrawing,
  drawingHereName,
  glyphAxesCell,
  glyphDrawingsCell,
  selectDrawing,
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

/** The edited glyph's drawings off the font's sources, as the Sources list names them. */
function drawings() {
  return glyphDrawingsCell(editor.asEditor())
    .peek()
    .map(({ name, active }) => ({ name, active }));
}

/** The layer of the drawing the Sources list names `name`. */
function drawingNamed(name: string): LayerId {
  const row = glyphDrawingsCell(editor.asEditor())
    .peek()
    // oxlint-disable-next-line shift/no-lookup-in-tests -- rows are named by location, the UI's only handle on them
    .find((drawing) => drawing.name === name);
  if (!row) throw new Error(`no drawing named ${name}`);
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

describe("a glyph with drawings off the font's sources", () => {
  it("opens and draws its default source", async () => {
    expect(await editor.drawnGlyph()).toMatchObject({
      bounds: { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
    });
  });

  it("draws a brace drawing between the font's sources", async () => {
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

  it("shows a glyph without axes of its own, so the first can be added", async () => {
    await editor.openGlyph("H");

    expect(glyphAxes()).toEqual({ glyph: "H", rows: [] });
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

describe("drawings off the font's sources in the Sources list", () => {
  it("are named by where they sit", async () => {
    expect(drawings()).toEqual([
      { name: "Spread 100", active: false },
      { name: "Strike 100", active: false },
    ]);

    await editor.openGlyph("H");
    expect(drawings()).toEqual([{ name: "Bleed 50", active: false }]);
  });

  it("moves the sliders to a drawing selected, and draws it", async () => {
    selectDrawing(editor.asEditor(), drawingNamed("Spread 100"));

    expect(drawings()).toContainEqual({ name: "Spread 100", active: true });
    expect(await editor.source("active")).toBeNull();
    expect(glyphAxes()?.rows).toEqual([
      ["Spread", 100],
      ["Strike", 0],
    ]);
    expect(await drawnWidth()).toBe(300);
  });

  it("edits the selected drawing and no other", async () => {
    selectDrawing(editor.asEditor(), drawingNamed("Spread 100"));
    editor.selectTool("select");
    editor.selectAll();
    await editor.pressKey("ArrowRight", { shiftKey: true });

    expect(await editor.drawnGlyph()).toMatchObject({ bounds: { min: { x: 10 } } });
    await editor.editSources(["Regular"]);
    expect(await editor.drawnGlyph()).toMatchObject({ bounds: { min: { x: 0 } } });
  });
});

describe("Add drawing here", () => {
  it("is offered only where the glyph has no drawing", () => {
    expect(addDrawingHereCell(editor.asEditor()).peek()).toBe(false);

    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 60);
    expect(addDrawingHereCell(editor.asEditor()).peek()).toBe(true);
    expect(drawingHereName(editor.asEditor())).toBe("Spread 60");

    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 100);
    expect(addDrawingHereCell(editor.asEditor()).peek()).toBe(false);
  });

  it("adds a drawing there from the outline shown, and edits it", async () => {
    setGlyphAxis(editor.asEditor(), axisId("SPRD"), 60);
    await addDrawingHere(editor.asEditor());

    expect(drawings()).toContainEqual({ name: "Spread 60", active: true });
    expect(await drawnWidth()).toBe(220);
    expect(addDrawingHereCell(editor.asEditor()).peek()).toBe(false);
  });

  it("deletes a drawing, leaving the glyph interpolated there", async () => {
    await deleteDrawing(editor.asEditor(), drawingNamed("Strike 100"));

    expect(drawings()).toEqual([{ name: "Spread 100", active: false }]);
  });
});
