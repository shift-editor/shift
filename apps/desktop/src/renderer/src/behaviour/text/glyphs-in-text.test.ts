import { beforeEach, describe, expect, it } from "vitest";
import { expectEdit } from "@/testing/expectEdit";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor();

/** A closed square from 100 to 300 in a glyph advancing 500: LSB 100, RSB 200. */
const SQUARE_100_TO_300 = { contours: [rect(100, 100, 200, 200)] };

// The text is AA, each A the square; the first is edited in place and the
// second starts at 500, so its square spans 600 to 800.
describe("glyphs in the text around the edited glyph", () => {
  beforeEach(async () => {
    await editor.draw(SQUARE_100_TO_300);
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
  });

  it("hovers a glyph's item inside its outline, and nothing in its empty space", () => {
    editor.movePointerTo({ x: 700, y: 200 });
    expect(editor.canvasText()).toMatchObject({ hoveredItemId: editor.canvasText()!.items[1]!.id });

    editor.movePointerTo({ x: 550, y: 200 });
    expect(editor.canvasText()).toMatchObject({ hoveredItemId: null });
  });

  it("never hovers the edited glyph's own item as text", () => {
    editor.movePointerTo({ x: 200, y: 200 });

    expect(editor.canvasText()).toMatchObject({ hoveredItemId: null });
  });

  it("moves the selection box with the edited glyph when an advance before it changes", async () => {
    editor.selectTool("text");
    editor.moveCaret(-1);
    editor.moveCaret(-1);
    editor.typeText("A");
    await editor.pressKey("Escape");
    editor.selectAll();
    const before = editor.selectionBox()!.min.x;

    editor.setAdvanceWidth(600);
    await editor.settle();

    expect(editor.selectionBox()).toMatchObject({ min: { x: expect.closeTo(before + 100) } });
  });

  it("selects a glyph's item when it is clicked", async () => {
    await editor.clickAt({ x: 700, y: 200 });

    expect(editor.selectionIds()).toEqual([editor.canvasText()!.items[1]!.id]);
  });

  it("edits a double-clicked glyph in place, as one undo step", async () => {
    await editor.doubleClickAt({ x: 700, y: 200 });
    expect(editor.canvasText()!).toMatchObject({
      openItemId: editor.canvasText()!.items[1]!.id,
      editedItemId: editor.canvasText()!.items[1]!.id,
    });

    await editor.undo();
    expect(editor.canvasText()!).toMatchObject({
      openItemId: editor.canvasText()!.items[0]!.id,
      editedItemId: editor.canvasText()!.items[0]!.id,
    });
  });

  it("deselects on the first Escape and leaves the edited glyph on the second", async () => {
    editor.selectAll();

    await editor.pressKey("Escape");
    expect(editor.selectionIds()).toEqual([]);
    expect(editor.canvasText()).toMatchObject({ editedItemId: editor.canvasText()!.items[0]!.id });

    await editor.pressKey("Escape");
    expect(editor.canvasText()!).toMatchObject({
      editedItemId: null,
      openItemId: editor.canvasText()!.items[0]!.id,
    });
  });

  it("leaves the edited glyph as one undo step", async () => {
    await editor.pressKey("Escape");
    await editor.undo();

    expect(editor.canvasText()).toMatchObject({ editedItemId: editor.canvasText()!.items[0]!.id });
  });

  it("hovers the glyph it left as text, and a double-click edits it again", async () => {
    await editor.pressKey("Escape");

    editor.movePointerTo({ x: 200, y: 200 });
    expect(editor.canvasText()).toMatchObject({ hoveredItemId: editor.canvasText()!.items[0]!.id });

    await editor.doubleClickAt({ x: 200, y: 200 });
    expect(editor.canvasText()).toMatchObject({ editedItemId: editor.canvasText()!.items[0]!.id });
  });

  it("draws Pen clicks over another glyph into the edited glyph", async () => {
    editor.selectTool("pen");

    await editor.clickAt({ x: 700, y: 200 });

    expect(await editor.outline()).toHaveLength(2);
  });

  describe("with no glyph edited", () => {
    beforeEach(() => editor.pressKey("Escape"));

    it("puts the selection box around a clicked glyph's outline", async () => {
      await editor.clickAt({ x: 700, y: 200 });

      expect(editor.selectionBox()).toMatchObject({ min: { x: 600 }, max: { x: 800 } });
    });

    it("selects the glyphs a marquee touches, never their points", async () => {
      await editor.dragFrom({ x: 150, y: 400 }, { x: 250, y: 150 });

      expect(editor.selectionIds()).toEqual([editor.canvasText()!.items[0]!.id]);
    });

    it("moves a dragged glyph's outline inside its advance", async () => {
      await expectEdit(
        editor,
        (e) => e.dragFrom({ x: 700, y: 200 }, { x: 750, y: 200 }),
        async (e) => {
          expect((await e.drawnGlyph("A")).sidebearings).toEqual({ lsb: 150, rsb: 150 });
          expect(await e.advanceWidth()).toBe(500);
        },
      );
    });

    it("grows the outline right from the box's right edge, keeping both sidebearings", async () => {
      await editor.clickAt({ x: 700, y: 200 });

      await editor.dragFrom({ x: 800, y: 200 }, { x: 1000, y: 200 });

      expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 100, rsb: 200 });
      expect(await editor.advanceWidth()).toBe(700);
    });

    it("grows the outline left from the box's left edge, into its left sidebearing", async () => {
      await editor.clickAt({ x: 700, y: 200 });

      await editor.dragFrom({ x: 600, y: 200 }, { x: 550, y: 200 });

      expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 50, rsb: 200 });
      expect(await editor.advanceWidth()).toBe(500);
    });

    it("grows both edges with Option, keeping the right sidebearing", async () => {
      await editor.clickAt({ x: 700, y: 200 });

      await editor.dragFrom({ x: 800, y: 200 }, { x: 850, y: 200 }, { altKey: true });

      expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 50, rsb: 200 });
      expect(await editor.advanceWidth()).toBe(550);
    });

    it("selects every glyph, and nudges a glyph selected twice only once", async () => {
      editor.selectAll();
      expect(editor.selectionIds()).toEqual(editor.canvasText()!.items.map((item) => item.id));

      await editor.pressKey("ArrowRight");

      expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 101, rsb: 199 });
    });
  });
});

describe("double-clicking a component", () => {
  it("opens its base glyph next to the edited glyph, as one undo step", async () => {
    await editor.addGlyph("B", 66);
    await editor.openGlyph("B");
    await editor.draw(SQUARE_100_TO_300);
    await editor.openGlyph("A");
    await editor.draw({ components: [{ glyph: "B" }] });

    await editor.doubleClickAt({ x: 200, y: 200 });

    expect(editor.canvasText()).toMatchObject({
      glyphs: [{ name: "A" }, { name: "B" }],
      openItemId: editor.canvasText()!.items[1]!.id,
      editedItemId: editor.canvasText()!.items[1]!.id,
    });

    await editor.undo();
    expect(editor.canvasText()).toMatchObject({
      items: [expect.anything()],
      openItemId: editor.canvasText()!.items[0]!.id,
    });
  });
});
