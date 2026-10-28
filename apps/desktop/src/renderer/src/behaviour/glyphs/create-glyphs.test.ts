import { describe, expect, it } from "vitest";
import type { Unicode } from "@shift/types";
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
