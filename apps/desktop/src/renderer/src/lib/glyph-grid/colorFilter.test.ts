import { describe, expect, it } from "vitest";
import type { MarkColor } from "@shift/types";
import { colorsInUse, filterByColor, glyphCountLabel } from "./colorFilter";
import { GlyphGridView, TILE_SIZE } from "./GlyphGridView";

const yellow: MarkColor = { kind: "named", named: "yellow" };
const green: MarkColor = { kind: "named", named: "darkGreen" };
const teal: MarkColor = { kind: "custom", custom: { red: 0, green: 0.5, blue: 0.5, alpha: 1 } };
const glyphs = [
  { name: "a", markColor: yellow },
  { name: "b", markColor: null },
  { name: "c", markColor: teal },
  { name: "d", markColor: yellow },
];
/** A grid view after pressing swatches, each alone or added with ⌘. */
function filtered(...presses: readonly [MarkColor | null, boolean][]) {
  const view = new GlyphGridView();
  for (const [color, add] of presses) view.filterColor(color, add);
  return view.colorFilterCell.peek();
}
const names = (shown: readonly { name: string }[]) => shown.map(({ name }) => name);

describe("filtering the glyph grid by tag colour", () => {
  it("shows every glyph until a colour is pressed, then only that colour", () => {
    expect(names(filterByColor(glyphs, filtered()))).toEqual(["a", "b", "c", "d"]);
    expect(names(filterByColor(glyphs, filtered([yellow, false])))).toEqual(["a", "d"]);
    expect(names(filterByColor(glyphs, filtered([null, false])))).toEqual(["b"]);
  });

  it("replaces the colour on a plain press and adds or removes one with ⌘", () => {
    expect(names(filterByColor(glyphs, filtered([yellow, false], [teal, false])))).toEqual(["c"]);
    expect(names(filterByColor(glyphs, filtered([yellow, false], [teal, true])))).toEqual([
      "a",
      "c",
      "d",
    ]);
    expect(filtered([yellow, false], [teal, true], [yellow, true]).size).toBe(1);
  });

  it("shows every glyph again when the only colour shown is pressed", () => {
    expect(filtered([yellow, false], [yellow, false]).size).toBe(0);
  });

  it("offers each colour in use, then untagged, with how many glyphs have it", () => {
    expect(colorsInUse(glyphs, filtered())).toEqual([
      { key: "yellow", color: yellow, count: 2 },
      { key: "0,0.5,0.5,1", color: teal, count: 1 },
      { key: "none", color: null, count: 1 },
    ]);
  });

  it("offers nothing when no glyph is tagged", () => {
    expect(colorsInUse([{ markColor: null }], filtered())).toEqual([]);
  });

  it("keeps offering a filtered colour no glyph has any more, so it can be switched off", () => {
    expect(colorsInUse(glyphs, filtered([green, false]))).toContainEqual({
      key: "darkGreen",
      color: green,
      count: 0,
    });
  });

  it("says what the grid shows", () => {
    expect(glyphCountLabel(3018, 3018, filtered())).toBe("3,018 glyphs");
    expect(glyphCountLabel(1, 1, filtered())).toBe("1 glyph");
    expect(glyphCountLabel(214, 3018, filtered())).toBe("214 of 3,018");
    expect(glyphCountLabel(3, 3018, filtered([yellow, false]))).toBe("3 yellow of 3,018");
    expect(glyphCountLabel(40, 3018, filtered([green, false]))).toBe("40 green of 3,018");
    expect(glyphCountLabel(9, 3018, filtered([null, false]))).toBe("9 untagged of 3,018");
    expect(glyphCountLabel(5, 3018, filtered([yellow, false], [teal, true]))).toBe("5 of 3,018");
  });
});

describe("the glyph grid's tile size", () => {
  it("stays within its limits", () => {
    const view = new GlyphGridView();

    view.setTileSize(10_000);
    expect(view.tileSizeCell.peek()).toBe(TILE_SIZE.max);
    view.setTileSize(1);
    expect(view.tileSizeCell.peek()).toBe(TILE_SIZE.min);
  });
});
