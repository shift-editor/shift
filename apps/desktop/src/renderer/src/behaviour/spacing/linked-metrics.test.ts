import { describe, expect, it } from "vitest";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

describe("linking a glyph's metrics to another glyph's with a key", () => {
  // `n` spans 50..450 of 500; `o` 40..480 of 520.
  const editor = useTestEditor({
    glyphs: {
      n: { outline: { advance: 500, contours: [rect(50, 0, 400, 700)] } },
      o: { outline: { advance: 520, contours: [rect(40, 0, 440, 700)] } },
    },
  });

  it("moves the side to the key's value, as one undoable step", async () => {
    await editor.openGlyph("o");

    expect(editor.linkMetric("left", "=n")).toBeNull();
    await editor.settle();

    expect((await editor.drawnGlyph()).sidebearings).toEqual({ lsb: 50, rsb: 40 });
    expect(editor.metricsLinks()).toMatchObject([{ side: "left", key: "=n", level: "glyph" }]);
    await editor.undo();
    expect((await editor.drawnGlyph()).sidebearings).toEqual({ lsb: 40, rsb: 40 });
    expect(editor.metricsLinks()).toEqual([]);
  });

  it("keeps the linked side following the glyph it names", async () => {
    await editor.openGlyph("o");
    editor.linkMetric("right", "=n+10");
    await editor.openGlyph("n");

    editor.setRightSidebearing(80);
    await editor.settle();
    await editor.openGlyph("o");

    expect((await editor.drawnGlyph()).sidebearings).toEqual({ lsb: 40, rsb: 90 });
  });

  it("refuses a key naming a glyph the font lacks and changes nothing", async () => {
    await editor.openGlyph("o");

    expect(editor.linkMetric("left", "=nn")).toBe("no glyph named `nn`");
    await editor.settle();

    expect(editor.metricsLinks()).toEqual([]);
    expect((await editor.drawnGlyph()).sidebearings).toEqual({ lsb: 40, rsb: 40 });
  });

  it("sets a key starting == on this source only", async () => {
    await editor.openGlyph("o");

    editor.linkMetric("left", "==n");
    await editor.settle();

    expect(editor.metricsLinks()).toMatchObject([{ side: "left", key: "==n", level: "layer" }]);
  });

  it("breaks the link when a value is typed into the linked side, undoing both together", async () => {
    await editor.openGlyph("o");
    editor.linkMetric("left", "=n");
    await editor.settle();

    editor.setLeftSidebearing(30);
    await editor.settle();

    expect((await editor.drawnGlyph()).sidebearings).toEqual({ lsb: 30, rsb: 40 });
    expect(editor.metricsLinks()).toEqual([]);
    await editor.undo();
    expect((await editor.drawnGlyph()).sidebearings).toEqual({ lsb: 50, rsb: 40 });
    expect(editor.metricsLinks()).toMatchObject([{ side: "left", key: "=n" }]);
  });
});
