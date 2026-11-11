import { describe, expect, it } from "vitest";
import type { GlyphName, Unicode } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

describe("creating glyphs for code points", () => {
  it("names each glyph from Unicode and adds them all as one undo step", async () => {
    const created = editor.createGlyphsForUnicodes([0x00e9, 0x0416] as Unicode[]);
    await editor.settle();

    expect(created.map(({ name, unicodes }) => [name, unicodes])).toEqual([
      ["eacute", [0x00e9]],
      ["Zhe-cy", [0x0416]],
    ]);
    expect(editor.glyphNamed("eacute")).toMatchObject({ unicodes: [0x00e9] });

    await editor.undo();

    expect(editor.glyphNamed("eacute")).toBeNull();
    expect(editor.glyphNamed("Zhe-cy")).toBeNull();
  });

  it("keeps a glyph encoded when its name falls back to uniXXXX", async () => {
    const [created] = editor.createGlyphsForUnicodes([0xe000] as Unicode[]);
    await editor.settle();

    expect(created).toMatchObject({ name: "uniE000", unicodes: [0xe000] });
    expect(editor.glyphNamed("uniE000")).toMatchObject({ unicodes: [0xe000] });
  });
});

describe("generating a language's missing glyphs", () => {
  it("creates letters encoded and positional forms by name, as one undo step", async () => {
    editor.generateGlyphs([
      { name: "beh-ar" as GlyphName, unicode: 0x0628 as Unicode },
      { name: "beh-ar.init" as GlyphName, unicode: null },
      { name: "lam_alef-ar" as GlyphName, unicode: null },
    ]);
    await editor.settle();

    expect(editor.glyphNamed("beh-ar")).toMatchObject({ unicodes: [0x0628] });
    expect(editor.glyphNamed("beh-ar.init")).toMatchObject({ unicodes: [] });
    expect(editor.glyphNamed("lam_alef-ar")).toMatchObject({ unicodes: [] });

    await editor.undo();

    expect(editor.glyphNamed("beh-ar")).toBeNull();
    expect(editor.glyphNamed("beh-ar.init")).toBeNull();
  });
});
