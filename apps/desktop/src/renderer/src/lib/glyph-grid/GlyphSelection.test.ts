import { describe, expect, it } from "vitest";
import type { GlyphId } from "@shift/types";
import { GlyphSelection } from "./GlyphSelection";

const glyphs = ["u", "uacute", "ubreve", "ucircumflex", "udieresis"] as GlyphId[];
const [u, uacute, ubreve, ucircumflex, udieresis] = glyphs as [
  GlyphId,
  GlyphId,
  GlyphId,
  GlyphId,
  GlyphId,
];
const none = GlyphSelection.empty(glyphs);
const plain = { range: false, toggle: false };
const shift = { range: true, toggle: false };
const command = { range: false, toggle: true };

describe("glyph selection", () => {
  it("selects a range from the anchor with Shift, in either direction", () => {
    const one = none.click(ubreve, plain);

    expect(one.click(udieresis, shift).ids).toEqual([ubreve, ucircumflex, udieresis]);
    expect(one.click(u, shift).ids).toEqual([u, uacute, ubreve]);
  });

  it("toggles single glyphs with ⌘, keeping grid order", () => {
    const two = none.click(udieresis, plain).click(uacute, command);

    expect(two.ids).toEqual([uacute, udieresis]);
    expect(two.click(udieresis, command).ids).toEqual([uacute]);
  });

  it("clears on a plain click in empty space but not on a modified one", () => {
    const one = none.click(u, plain);

    expect(one.click(null, plain).ids).toEqual([]);
    expect(one.click(null, shift).ids).toEqual([u]);
  });

  it("selects every glyph a drag passes over", () => {
    expect(none.drag(ucircumflex, uacute).ids).toEqual([uacute, ubreve, ucircumflex]);
  });

  it("moves with the arrow keys, stopping at the ends, and extends with Shift", () => {
    const last = none.click(udieresis, plain);

    expect(last.step(1, false).ids).toEqual([udieresis]);
    expect(last.step(-1, true).ids).toEqual([ucircumflex, udieresis]);
    expect(none.step(1, false).ids).toEqual([u]);
  });

  it("moves a row at a time when the step is a row's worth of glyphs", () => {
    const first = none.click(u, plain);

    expect(first.step(3, false).ids).toEqual([ucircumflex]);
    expect(first.step(3, true).ids).toEqual([u, uacute, ubreve, ucircumflex]);
    expect(first.step(3, false).step(3, false).ids).toEqual([udieresis]);
  });

  it("selects the glyphs a dragged box touches, added to a kept selection", () => {
    const one = none.click(u, plain);

    expect(one.box([ubreve, ucircumflex], null).ids).toEqual([ubreve, ucircumflex]);
    expect(one.box([ubreve, ucircumflex], one).ids).toEqual([u, ubreve, ucircumflex]);
    expect(one.box([], null).ids).toEqual([]);
  });

  it("names the glyph last moved to as primary while it is selected", () => {
    const two = none.click(uacute, plain).click(udieresis, command);

    expect(two.primary).toBe(udieresis);
    expect(two.click(udieresis, command).primary).toBe(uacute);
    expect(none.primary).toBeNull();
  });

  it("drops glyphs that left the grid", () => {
    const after = none.drag(u, uacute).withGlyphs([uacute, ubreve]);

    expect(after.ids).toEqual([uacute]);
    expect(after.anchor).toBeNull();
    expect(after.step(1, false).ids).toEqual([ubreve]);
  });
});
