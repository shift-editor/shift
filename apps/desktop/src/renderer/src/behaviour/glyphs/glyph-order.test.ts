import { describe, expect, it } from "vitest";
import type { Unicode } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ glyphs: { z: {} } });

describe("the glyph list keeps the engine's name order", () => {
  it("places an added, a renamed and a removed glyph by name", async () => {
    editor.createGlyphsForUnicodes([0x00e9] as Unicode[]);
    await editor.settle();
    expect(await editor.glyphNames()).toEqual(["A", "eacute", "z"]);

    editor.setGlyphIdentity("eacute", "Zed", [0x00e9]);
    await editor.settle();
    expect(await editor.glyphNames()).toEqual(["A", "Zed", "z"]);

    await editor.undo();
    await editor.undo();
    expect(await editor.glyphNames()).toEqual(["A", "z"]);
  });
});
