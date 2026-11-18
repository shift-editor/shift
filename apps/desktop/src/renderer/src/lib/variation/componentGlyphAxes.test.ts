import { describe, expect, it } from "vitest";
import type { LayerId } from "@shift/types";
import { FONTS, useTestEditor } from "@/testing/fontFixture";
import { selectedComponentLocationCell, setSelectedComponentAxis } from "./componentLocation";
import { glyphDrawingsCell, selectDrawing } from "./glyphAxes";

// Solenoid's `H` is two `dot`s, the first drawn at Spread 60 (80 in its Bleed
// 50 drawing). `dot` has its own Spread and Strike axes (0–100): a 100 × 100
// square, 300 tall at Strike 100.
const editor = useTestEditor({ file: FONTS.solenoid, glyph: "H" });

/** What the component section shows, by axis name and whose axis it is. */
function shown() {
  const location = selectedComponentLocationCell(editor.asEditor()).peek();
  if (!location) return null;

  return {
    set: location.set.map(({ axis, kind, value }) => [kind, axis.name, value]),
    followed: location.followed.map(({ axis, kind, follows }) => [kind, axis.name, follows]),
  };
}

/** Selects `H`'s first component by clicking its middle, as a user does. */
async function selectFirstDot() {
  const { components } = await editor.drawnGlyph();
  const bounds = components[0]!.bounds!;
  await editor.clickAt({ x: bounds.min.x + 20, y: (bounds.min.y + bounds.max.y) / 2 });
}

function axisOfDot(name: string) {
  const location = selectedComponentLocationCell(editor.asEditor()).peek();
  const entries = [...(location?.set ?? []), ...(location?.followed ?? [])];
  // oxlint-disable-next-line shift/no-lookup-in-tests -- the section lists the base glyph's own axes, which the axis selector does not read
  const entry = entries.find(({ axis }) => axis.name === name);
  if (!entry) throw new Error(`the section has no ${name}`);
  return entry.axis.id;
}

function drawingNamed(name: string): LayerId {
  // oxlint-disable-next-line shift/no-lookup-in-tests -- rows are named by location, the UI's only handle on them
  const row = glyphDrawingsCell(editor.asEditor())
    .peek()
    .find((drawing) => drawing.name === name);
  if (!row) throw new Error(`no drawing named ${name}`);
  return row.layerId;
}

describe("the component section with a base glyph's own axes", () => {
  it("lists the base glyph's axes after the font's, a set one with its value", async () => {
    await selectFirstDot();

    expect(shown()).toEqual({
      set: [["glyph", "Spread", 60]],
      followed: [
        ["font", "Bleed", 0],
        ["glyph", "Strike", 0],
      ],
    });
  });

  it("sets a glyph axis, which draws the base there", async () => {
    await selectFirstDot();
    await setSelectedComponentAxis(editor.asEditor(), axisOfDot("Strike"), 50);

    expect(shown()?.set).toEqual([
      ["glyph", "Spread", 60],
      ["glyph", "Strike", 50],
    ]);
    expect(await editor.drawnGlyph()).toMatchObject({
      components: [{ glyph: "dot", bounds: { min: { y: 0 }, max: { y: 200 } } }, { glyph: "dot" }],
    });
  });

  it("shows on a drawing off the font's sources, with that drawing's values", async () => {
    selectDrawing(editor.asEditor(), drawingNamed("Bleed 50"));
    await selectFirstDot();

    expect(shown()?.set).toEqual([["glyph", "Spread", 80]]);
  });

  it("hides between drawings, where there is nothing to edit", async () => {
    await selectFirstDot();
    editor.setLocation({ BLED: 25 });

    expect(shown()).toBeNull();
  });
});
