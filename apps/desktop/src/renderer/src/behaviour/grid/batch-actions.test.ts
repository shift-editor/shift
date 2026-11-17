import { describe, expect, it } from "vitest";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

describe("acting on several glyphs from the glyph grid", () => {
  // `n` spans 50..450 of 500; `o` 40..480 of 520; `no` draws both, `o` 500 to the right.
  const editor = useTestEditor({
    glyphs: {
      n: { outline: { advance: 500, contours: [rect(50, 0, 400, 700)] } },
      o: { outline: { advance: 520, contours: [rect(40, 0, 440, 700)] } },
      no: {
        outline: { advance: 1020, components: [{ glyph: "n" }, { glyph: "o", x: 500 }] },
      },
      space: { outline: { advance: 250 } },
    },
  });
  const sidebearings = async (name: string) => {
    await editor.openGlyph(name);
    return (await editor.drawnGlyph()).sidebearings;
  };

  it("duplicates glyphs under numbered names, as one undo step", async () => {
    await editor.duplicateGlyphs(["n", "o"]);
    await editor.duplicateGlyphs(["n"]);

    expect(await editor.glyphNames()).toEqual(expect.arrayContaining(["n.001", "o.001", "n.002"]));
    expect(await sidebearings("n.001")).toEqual({ lsb: 50, rsb: 50 });

    await editor.undo();
    await editor.undo();
    expect(await editor.glyphNames()).toEqual(["A", "n", "no", "o", "space"]);
  });

  it("decomposes a glyph's components into its own contours, as one undo step", async () => {
    // `n` has no components, so only `no` counts as decomposed.
    expect(await editor.decomposeGlyphs(["no", "n"])).toBe(1);
    await editor.openGlyph("no");

    expect(await editor.drawnGlyph()).toMatchObject({
      components: [],
      sidebearings: { lsb: 50, rsb: 40 },
    });
    expect(await editor.outline()).toHaveLength(2);

    await editor.undo();
    // The grid's toast says which step undo reversed, by the name the action gave it.
    expect(await editor.replayedStep()).toEqual({
      direction: "undo",
      label: "Decompose Components",
    });
    await editor.openGlyph("no");
    expect((await editor.drawnGlyph()).components).toHaveLength(2);
  });

  it("sets and adjusts the sidebearings of every glyph that draws something", async () => {
    await editor.setSidebearings(["n", "o", "space"], { kind: "set", set: 30 }, { kind: "keep" });
    await editor.setSidebearings(["n", "o"], { kind: "keep" }, { kind: "adjust", adjust: 5 });

    expect(await sidebearings("n")).toEqual({ lsb: 30, rsb: 55 });
    expect(await sidebearings("o")).toEqual({ lsb: 30, rsb: 45 });
    await editor.openGlyph("space");
    expect((await editor.drawnGlyph()).advanceWidth).toBe(250);

    await editor.undo();
    await editor.undo();
    expect(await sidebearings("n")).toEqual({ lsb: 50, rsb: 50 });
    expect(await sidebearings("o")).toEqual({ lsb: 40, rsb: 40 });
  });

  it("links a side of several glyphs with one key", async () => {
    await editor.setSidebearings(["n", "o"], { kind: "keep" }, { kind: "link", link: "=|" });

    expect(await sidebearings("n")).toEqual({ lsb: 50, rsb: 50 });
    expect(await sidebearings("o")).toEqual({ lsb: 40, rsb: 40 });
    expect(editor.metricsLinks()).toMatchObject([{ side: "right", key: "=|" }]);
  });

  it("adds a glyph picked in the Glyphs tab to the end of the shown page's text", async () => {
    const pageId = (await editor.openGlyphsAsText(["n"]))!;
    editor.showPage(pageId);

    expect(await editor.insertGlyphIntoText("o")).toBe(true);
    expect(await editor.insertGlyphIntoText("space")).toBe(true);
    expect(editor.pageText(pageId)).toBe("/n/o/space");

    await editor.undo();
    expect(editor.pageText(pageId)).toBe("/n/o");
  });

  it("opens several glyphs as one line of text on a new page", async () => {
    const pages = editor.pageList().length;

    const pageId = await editor.openGlyphsAsText(["o", "n", "space"]);

    expect(editor.pageList()).toHaveLength(pages + 1);
    expect(editor.pageText(pageId!)).toBe("/o/n/space");

    await editor.undo();
    expect(editor.pageList()).toHaveLength(pages);
  });
});
