import { beforeEach, describe, expect, it } from "vitest";
import { LOCK_GAP_PX, LOCK_SIZE_PX } from "@shift/editor/rendering";
import { line } from "@/testing/fixtures";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ mode: "preview" });
beforeEach(async () => {
  await editor.draw({
    contours: [line([100, 100], [200, 200])],
  });
  editor.selectTool("select");
});

describe("a preview session only looks", () => {
  it("disables the authoring tools but keeps Select and Text", () => {
    expect(editor.toolDisabled("select")).toBe(false);
    expect(editor.toolDisabled("text")).toBe(false);
    expect(editor.toolDisabled("pen")).toBe(true);
    expect(editor.toolDisabled("shape")).toBe(true);
  });

  it("types proof text with the Text tool", async () => {
    editor.selectTool("text");

    await editor.typeText("AA");

    expect(editor.toolState()).toMatchObject({ state: "editing" });
    expect(editor.canvasText()).toMatchObject({ items: Array(3).fill(expect.anything()) });
  });

  it("neither hovers, selects nor marquees", async () => {
    await editor.clickAt({ x: 100, y: 100 });
    expect(editor.selectionIds()).toEqual([]);

    editor.movePointerTo({ x: 100, y: 100 });
    expect(editor.hoveredId()).toBeNull();

    await editor.dragFrom({ x: 80, y: 80 }, { x: 150, y: 150 });
    expect(editor.selectionIds()).toEqual([]);
    expect(editor.toolState()).toMatchObject({ state: "ready" });
  });

  it("treats a click on the preview lock as a click on empty canvas", async () => {
    const pixel = editor.pixelSize();
    const lock = {
      x: (await editor.advanceWidth()) / 2,
      y: editor.metrics().descender - (LOCK_GAP_PX + LOCK_SIZE_PX / 2) * pixel,
    };

    expect(editor.targetAt(lock)).toBe("canvas");
    await editor.clickAt(lock);

    expect(editor.selectionIds()).toEqual([]);
    expect(editor.toolState()).toMatchObject({ state: "ready" });
  });
});

// A preview looks at the font the way a document does, double-clicks
// included; it only refuses what would change the font's data.
describe("double-clicking in a preview", () => {
  it("opens a text glyph in place to look at, after Text mode left none open", async () => {
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
    await editor.pressKey("Escape");
    expect(editor.canvasText()).toMatchObject({ editedItemId: null });
    const second = editor.canvasText()!.glyphs[1]!;

    await editor.doubleClickAt({ x: second.origin.x + 150, y: 150 });

    expect(editor.canvasText()).toMatchObject({ editedItemId: editor.canvasText()!.items[1]!.id });
  });

  it("leaves a point as it was rather than making it smooth", async () => {
    const { lone } = await editor.draw({
      contours: [{ points: [{ x: 300, y: 300, name: "lone" }] }],
    });

    await editor.doubleClickAt({ x: 300, y: 300 });

    expect(await editor.point(lone)).toMatchObject({ smooth: false });
  });
});

describe("double-clicking a component in a preview", () => {
  // Adieresis is A plus a dieresis; A's crossbar spans 75 to 325 at 164 to 200.
  const composite = useTestEditor({
    file: FONTS.mutatorSansLightCondensed,
    glyph: "Adieresis",
    mode: "preview",
  });

  it("opens its base glyph next to the open glyph, to look at", async () => {
    composite.selectTool("select");
    expect(composite.targetAt({ x: 200, y: 182 })).toBe("component");

    await composite.doubleClickAt({ x: 200, y: 182 });

    expect(composite.canvasText()).toMatchObject({
      glyphs: [{ name: "Adieresis" }, { name: "A" }],
      editedItemId: composite.canvasText()!.items[1]!.id,
    });
  });
});
