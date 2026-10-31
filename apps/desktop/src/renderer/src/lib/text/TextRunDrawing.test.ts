import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import type { EditorTestSurface } from "@/testing/surface";
import { openTestEditor } from "@/testing/TestEditor";

const FONT = resolve(process.cwd(), "../../fixtures/fonts/AnchorDragBench.glyphs");

/** Types `text` after the edited glyph in Text mode, then goes back to editing it. */
async function typeAfterEditedGlyph(editor: EditorTestSurface, text: string): Promise<void> {
  editor.selectTool("text");
  editor.typeText(text);
  await editor.pressKey("Escape");
  await editor.settle();
}

describe("text run drawing", () => {
  let editor: EditorTestSurface;

  afterEach(() => editor.close());

  /** How many times the latest frame fills `glyph`'s closed contours as they are now. */
  const fillsOf = (glyph: string) => {
    const { closed } = editor.drawnOutlineIds(glyph);
    return editor.latestCanvasFrame().fills.filter((fill) => fill === closed).length;
  };

  it("redraws every composite occurrence when an outline only the run draws changes", async () => {
    // The dieresis is a component of both composites; u stays the edited glyph throughout.
    editor = await openTestEditor(FONT, "u");
    editor.selectTool("text");
    editor.typeText("ǖlǖü");
    // At the start of the text the dieresis has no base, so it is a run glyph of its own.
    editor.moveCaret(-1, "line");
    editor.pasteText("/dieresiscomb");
    await editor.pressKey("Escape");
    await editor.settle();
    editor.recordCanvas();
    await expect.poll(() => fillsOf("udieresismacron")).toBe(2);

    // The dieresis's first point, in the edited u's units.
    const text = editor.canvasText();
    const placed = (name: string) => text?.glyphs.find((glyph) => glyph.name === name);
    const dieresis = placed("dieresiscomb");
    const u = placed("u");
    const [contour] = (await editor.layerOf("dieresiscomb")).contours;
    const point = contour?.points[0];
    if (!dieresis || !u || !point) throw new Error("Expected the dieresis and u in the text");
    const at = { x: dieresis.origin.x - u.left + point.x, y: dieresis.origin.y + point.y };
    editor.selectTool("select");
    await editor.clickAt(at);
    const drawnBefore = editor.drawnOutlineIds("udieresismacron").closed;
    // Dragging the selected run glyph previews a move of its outline and commits nothing, and
    // the dieresis is not the edited glyph, so only the run's own subscriptions can redraw it.
    editor.holdDragFrom(at, { x: at.x + 25, y: at.y });

    await expect.poll(() => fillsOf("udieresismacron")).toBe(2);
    expect(editor.canvasText()?.editedItemId).toBe(text?.editedItemId);
    expect(editor.drawnOutlineIds("udieresismacron").closed).not.toBe(drawnBefore);
    expect(editor.latestCanvasFrame().fills).not.toContain(drawnBefore);
    expect(fillsOf("udieresis")).toBe(1);
  });

  it("draws every occurrence of a glyph that loads after the run first draws", async () => {
    editor = await openTestEditor(FONT, "u");
    expect(editor.glyphLoaded("o")).toBe(false);
    editor.recordCanvas();

    await typeAfterEditedGlyph(editor, "ouo");

    await expect.poll(() => fillsOf("o")).toBe(2);
  });

  it("starts stroking a run glyph's open contour when one of its contours opens", async () => {
    editor = await openTestEditor(FONT, "o");
    editor.recordCanvas();
    await typeAfterEditedGlyph(editor, "ouo");
    await expect.poll(() => fillsOf("o")).toBe(2);

    const strokesOfOpenPath = () => {
      const { open } = editor.drawnOutlineIds("o");
      return editor.latestCanvasFrame().strokes.filter((stroke) => stroke === open).length;
    };
    // Closed contours only: the run strokes nothing for it.
    expect((await editor.outline()).some((contour) => !contour.closed)).toBe(false);
    expect(strokesOfOpenPath()).toBe(0);
    const [contour] = await editor.outline();
    const point = contour?.points[0];
    if (!point) throw new Error("Expected a point in the o");
    editor.select([point.id as PointId]);
    await editor.deleteSelection("gap");

    await expect.poll(strokesOfOpenPath).toBe(2);
  });
});
