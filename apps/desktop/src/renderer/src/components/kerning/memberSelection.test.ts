import { describe, expect, it } from "vitest";
import type { GlyphId } from "@shift/types";
import {
  NO_MEMBERS_SELECTED,
  clickSelection,
  dragSelection,
  retainMembers,
  stepSelection,
} from "./memberSelection";

const members = ["u", "uacute", "ubreve", "ucircumflex", "udieresis"] as GlyphId[];
const [u, uacute, ubreve, ucircumflex, udieresis] = members as [
  GlyphId,
  GlyphId,
  GlyphId,
  GlyphId,
  GlyphId,
];
const plain = { range: false, toggle: false };

describe("group member selection", () => {
  it("selects a range from the anchor with Shift, in either direction", () => {
    const one = clickSelection(members, NO_MEMBERS_SELECTED, ubreve, plain);

    expect(clickSelection(members, one, udieresis, { range: true, toggle: false }).ids).toEqual([
      ubreve,
      ucircumflex,
      udieresis,
    ]);
    expect(clickSelection(members, one, u, { range: true, toggle: false }).ids).toEqual([
      u,
      uacute,
      ubreve,
    ]);
  });

  it("toggles single members with ⌘, keeping member order", () => {
    const one = clickSelection(members, NO_MEMBERS_SELECTED, udieresis, plain);
    const two = clickSelection(members, one, uacute, { range: false, toggle: true });

    expect(two.ids).toEqual([uacute, udieresis]);
    expect(clickSelection(members, two, udieresis, { range: false, toggle: true }).ids).toEqual([
      uacute,
    ]);
  });

  it("clears on a plain click in empty space but not on a modified one", () => {
    const one = clickSelection(members, NO_MEMBERS_SELECTED, u, plain);

    expect(clickSelection(members, one, null, plain).ids).toEqual([]);
    expect(clickSelection(members, one, null, { range: true, toggle: false }).ids).toEqual([u]);
  });

  it("selects every member a drag passes over", () => {
    expect(dragSelection(members, ucircumflex, uacute).ids).toEqual([uacute, ubreve, ucircumflex]);
  });

  it("moves with the arrow keys, stopping at the ends, and extends with Shift", () => {
    const last = clickSelection(members, NO_MEMBERS_SELECTED, udieresis, plain);

    expect(stepSelection(members, last, 1, false).ids).toEqual([udieresis]);
    expect(stepSelection(members, last, -1, true).ids).toEqual([ucircumflex, udieresis]);
    expect(stepSelection(members, NO_MEMBERS_SELECTED, 1, false).ids).toEqual([u]);
  });

  it("drops glyphs that left the group", () => {
    const both = dragSelection(members, u, uacute);

    const after = retainMembers(both, [uacute, ubreve]);

    expect(after.ids).toEqual([uacute]);
    expect(after.anchor).toBeNull();
  });
});
