import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { LOCK_GAP_PX, LOCK_SIZE_PX } from "@shift/editor/rendering";
import { line } from "@/testing/fixtures";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// A preview looks at its font the way a document does: hovering, selecting,
// marquees and double-clicks all work. It only refuses what would change the
// font's data, changing nothing and saying the font is read-only.
const editor = useTestEditor({ mode: "preview" });
let start: PointId;
let end: PointId;
beforeEach(async () => {
  ({ start, end } = await editor.draw({
    contours: [line({ x: 100, y: 100, name: "start" }, { x: 200, y: 200, name: "end" })],
  }));
  editor.selectTool("select");
});

describe("a preview session looks as a document does", () => {
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

  it("hovers, selects and marquees points, without saying it is read-only", async () => {
    editor.movePointerTo({ x: 100, y: 100 });
    expect(editor.hoveredId()).toBe(start);

    await editor.clickAt({ x: 100, y: 100 });
    expect(editor.selectionIds()).toEqual([start]);

    await editor.dragFrom({ x: 80, y: 80 }, { x: 250, y: 250 });
    expect(editor.selectionIds()).toEqual(expect.arrayContaining([start, end]));
    expect(editor.readOnlyNotices()).toBe(0);
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

describe("a preview session refuses what would change the font", () => {
  it("leaves a dragged point where it was, and says the font is read-only", async () => {
    await editor.dragFrom({ x: 100, y: 100 }, { x: 150, y: 120 });

    expect(await editor.point(start)).toMatchObject({ x: 100, y: 100 });
    expect(editor.readOnlyNotices()).toBeGreaterThan(0);
  });

  it("leaves a nudged point where it was, and says the font is read-only", async () => {
    await editor.clickAt({ x: 100, y: 100 });

    await editor.pressKey("ArrowRight");

    expect(await editor.point(start)).toMatchObject({ x: 100, y: 100 });
    expect(editor.readOnlyNotices()).toBe(1);
  });

  it("leaves a double-clicked point as it was rather than making it smooth", async () => {
    const { lone } = await editor.draw({
      contours: [{ points: [{ x: 300, y: 300, name: "lone" }] }],
    });

    await editor.doubleClickAt({ x: 300, y: 300 });

    expect(await editor.point(lone)).toMatchObject({ smooth: false });
    expect(editor.readOnlyNotices()).toBe(1);
  });
});

describe("double-clicking in a preview", () => {
  // The text is AA: the first A is the open glyph, the second starts at its advance.
  beforeEach(async () => {
    editor.selectTool("text");
    editor.typeText("A");
    await editor.pressKey("Escape");
    await editor.pressKey("Escape");
    expect(editor.canvasText()).toMatchObject({ editedItemId: null });
  });

  it("opens a text glyph in place to look at, after Text mode left none open", async () => {
    const second = editor.canvasText()!.glyphs[1]!;

    await editor.doubleClickAt({ x: second.origin.x + 150, y: 150 });

    expect(editor.canvasText()).toMatchObject({ editedItemId: editor.canvasText()!.items[1]!.id });
  });

  it("highlights a glyph in the text under the pointer, as a document does", () => {
    const second = editor.canvasText()!.glyphs[1]!;

    editor.movePointerTo({ x: second.origin.x + 150, y: 150 });

    expect(editor.canvasText()).toMatchObject({ hoveredItemId: editor.canvasText()!.items[1]!.id });
  });
});

describe("double-clicking a component in a preview", () => {
  // Adieresis is A plus a dieresis; A's crossbar spans 75 to 325 at 164 to 200.
  const composite = useTestEditor({
    file: FONTS.mutatorSansLightCondensed,
    glyph: "Adieresis",
    mode: "preview",
  });

  it("highlights the component under the pointer", async () => {
    composite.selectTool("select");
    const [a] = await composite.components();

    composite.movePointerTo({ x: 200, y: 182 });

    expect(composite.hoveredId()).toBe(a!.id);
  });

  it("opens its base glyph next to the open glyph, to look at", async () => {
    composite.selectTool("select");
    expect(composite.targetAt({ x: 200, y: 182 })).toBe("component");

    await composite.doubleClickAt({ x: 200, y: 182 });

    expect(composite.canvasText()).toMatchObject({
      glyphs: [{ name: "Adieresis" }, { name: "A" }],
      editedItemId: composite.canvasText()!.items[1]!.id,
    });
    // Opening it changes nothing, so the preview does not say it is read-only.
    expect(composite.readOnlyNotices()).toBe(0);
  });
});
