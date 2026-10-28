import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

// The text is two A's, each a closed square from 100 to 300 in a 500 advance:
// LSB 100, RSB 200. The first A is the open glyph, drawn from 0.
const editor = useTestEditor({
  glyphs: { A: { outline: { contours: [rect(100, 100, 200, 200)] } } },
});
/** The text's two items, the open glyph's first. */
let first: string;
let second: string;
beforeEach(async () => {
  editor.selectTool("text");
  editor.typeText("A");
  await editor.pressKey("Escape");
  editor.selectTool("spacing");
  [first, second] = editor.canvasText()!.items.map(({ id }) => id) as [string, string];
});

/**
 * Hovers and clicks a position, as a user points before clicking.
 * Kept: several tests pick a half this way, and the Spacing tool acts on what the pointer hovers.
 */
async function clickHalf(x: number, y = 150): Promise<void> {
  editor.movePointerTo({ x, y });
  await editor.clickAt({ x, y });
}

describe("the Spacing tool", () => {
  it("shows every glyph as text while active, and edits the glyph again on leaving", () => {
    expect(editor.canvasText()!.editedItemId).toBeNull();

    editor.selectTool("select");

    expect(editor.canvasText()!.editedItemId).toBe(first);
  });

  it("shows the left glyph's RSB and the right glyph's LSB between two glyphs", () => {
    editor.movePointerTo({ x: 450, y: 200 });

    expect(editor.spacingTool()?.hovered?.gap).toMatchObject({
      leftBoundary: 500,
      rightBoundary: 500,
      left: { sidebearing: 200, edge: 300 },
      right: { sidebearing: 100, edge: 600 },
    });
  });

  it("picks the half under the pointer as the sidebearing a drag changes", () => {
    editor.movePointerTo({ x: 450, y: 200 });
    expect(editor.spacingTool()?.hovered?.side).toBe("left");

    editor.movePointerTo({ x: 550, y: 200 });
    expect(editor.spacingTool()?.hovered?.side).toBe("right");
  });

  it("shows only the LSB before the first glyph", () => {
    editor.movePointerTo({ x: 50, y: 200 });

    expect(editor.spacingTool()?.hovered).toMatchObject({
      side: "right",
      gap: { leftBoundary: 0, rightBoundary: 0, left: null, right: { sidebearing: 100 } },
    });
  });

  it("finds every other place the same glyph shows the hovered sidebearing", () => {
    editor.movePointerTo({ x: 450, y: 200 });

    // The first A's RSB; the second A's RSB, at the line end, is the only other.
    expect(editor.spacingTool()?.hovered?.side).toBe("left");
    expect(editor.spacingTool()?.sameAsHovered).toHaveLength(1);
    expect(editor.spacingTool()?.sameAsHovered[0]).toMatchObject({
      side: "left",
      gap: { leftBoundary: 1000 },
    });
  });

  it("shows no gap inside a glyph's outline, away from its edges", () => {
    editor.movePointerTo({ x: 200, y: 200 });

    expect(editor.spacingTool()?.hovered).toBeNull();
  });

  it("follows a sidebearing edit", async () => {
    editor.setAdvanceWidth(520);
    await editor.settle();

    editor.movePointerTo({ x: 450, y: 200 });

    expect(editor.spacingTool()?.hovered?.gap).toMatchObject({
      leftBoundary: 520,
      rightBoundary: 520,
      left: { sidebearing: 220 },
    });
  });

  it("drops the selected half when an undo takes one of its glyphs away", async () => {
    await clickHalf(450, 200);
    expect(editor.spacingTool()?.selected).not.toBeNull();

    // Undoing the typing removes the second A, so the gap between the two is gone.
    await editor.undo();

    expect(editor.spacingTool()?.selected).toBeNull();
  });
});

describe("dragging a sidebearing", () => {
  it("widens the left glyph's RSB by dragging the left half right", async () => {
    await editor.dragFrom({ x: 450, y: 200 }, { x: 470, y: 200 });

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 100, rsb: 220 });
    expect(await editor.advanceWidth()).toBe(520);
  });

  it("widens the right glyph's LSB by dragging the right half right, keeping its RSB", async () => {
    await editor.dragFrom({ x: 550, y: 200 }, { x: 570, y: 200 });

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 120, rsb: 200 });
    expect(await editor.advanceWidth()).toBe(520);
  });

  it("snaps to the other sidebearing when dragged close to it", async () => {
    // LSB 100 dragged to 198 lands within a few pixels of the RSB of 200.
    await editor.dragFrom({ x: 550, y: 200 }, { x: 648, y: 200 });

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 200, rsb: 200 });
  });

  it("drags without snapping while the accelerator is held", async () => {
    await editor.dragFrom({ x: 550, y: 200 }, { x: 648, y: 200 }, { metaKey: true });

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 198, rsb: 200 });
  });

  it("is one undo step", async () => {
    await editor.dragFrom({ x: 550, y: 200 }, { x: 590, y: 200 });

    await editor.undo();

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 100, rsb: 200 });
    expect(await editor.advanceWidth()).toBe(500);
  });

  it("picks a negative RSB's half where it overlaps the next glyph", async () => {
    // RSB -20: the outline ends at 300, past the boundary at 280.
    editor.setAdvanceWidth(280);
    await editor.settle();

    editor.movePointerTo({ x: 290, y: 200 });

    expect(editor.spacingTool()?.hovered).toMatchObject({
      side: "left",
      gap: { leftBoundary: 280, rightBoundary: 280, left: { sidebearing: -20, edge: 300 } },
    });
  });

  it("can take a sidebearing below zero, and keeps showing its gap", async () => {
    await editor.dragFrom({ x: 450, y: 200 }, { x: 200, y: 200 });

    expect((await editor.drawnGlyph("A")).sidebearings.rsb).toBe(-50);
    expect(editor.spacingTool()?.hovered?.gap.left).toMatchObject({ sidebearing: -50 });
  });
});

describe("typing a sidebearing", () => {
  /** The left half's value, in its middle: between the outline edge at 300 and the boundary at 500. */
  let leftValue: Point2D;
  beforeEach(() => {
    editor.movePointerTo({ x: 450, y: 200 });
    const { top, bottom } = editor.spacingTool()!.hovered!.gap;
    leftValue = { x: 400, y: (top + bottom) / 2 };
  });

  it("marks the value under the pointer and shows the pointer cursor", () => {
    editor.movePointerTo(leftValue);

    expect(editor.spacingTool()?.overValue).toBe(true);
    expect(editor.shownCursor()).toBe("pointer");
  });

  it("opens the hovered half's value on a click on it, and not elsewhere in the gap", async () => {
    await editor.clickAt({ x: 450, y: 200 });
    expect(editor.spacingTool()?.editing).toBeNull();

    await editor.clickAt(leftValue);

    expect(editor.spacingTool()?.editing?.side).toBe("left");
  });

  it("sets that sidebearing exactly, as one undo step", async () => {
    await editor.clickAt(leftValue);

    editor.typeSidebearing(150);
    await editor.settle();

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 100, rsb: 150 });
    expect(editor.spacingTool()?.editing?.gap.left?.sidebearing).toBe(150);
    await editor.undo();
    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 100, rsb: 200 });
  });

  it("switches to the other half of the same gap", async () => {
    await editor.clickAt(leftValue);

    editor.switchSidebearingSide();
    editor.typeSidebearing(60);
    await editor.settle();

    expect(editor.spacingTool()?.editing?.side).toBe("right");
    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 60, rsb: 200 });
  });

  it("closes on a canvas click away from the value, and stays open on a click on it", async () => {
    await editor.clickAt(leftValue);

    await editor.clickAt(leftValue);
    expect(editor.spacingTool()?.editing?.side).toBe("left");

    await editor.clickAt({ x: 200, y: 200 });
    expect(editor.toolState()).toEqual({ id: "spacing", state: "ready" });
  });

  it("returns to hovering when closed", async () => {
    await editor.clickAt(leftValue);

    editor.closeSidebearingField();

    expect(editor.toolState()).toEqual({ id: "spacing", state: "ready" });
  });
});

describe("selecting and nudging a sidebearing", () => {
  it("selects a clicked half and opens its glyph", async () => {
    await clickHalf(550);

    expect(editor.spacingTool()?.selected?.side).toBe("right");
    expect(editor.canvasText()!.openItemId).toBe(second);
  });

  it("opens a dragged half's glyph without a click first", async () => {
    await clickHalf(50);
    expect(editor.canvasText()!.openItemId).toBe(first);

    await editor.dragFrom({ x: 550, y: 150 }, { x: 570, y: 150 });

    expect(editor.canvasText()!.openItemId).toBe(second);
  });

  it("nudges the selected half with the arrow keys and hides the overlay until the pointer moves", async () => {
    await clickHalf(450);

    await editor.pressKey("ArrowRight");
    await editor.pressKey("ArrowRight", { shiftKey: true });

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 100, rsb: 211 });
    expect(editor.spacingTool()?.quiet).toBe(true);
    editor.movePointerTo({ x: 460, y: 150 });
    expect(editor.spacingTool()?.quiet).toBe(false);
  });

  it("nudges the hovered half when nothing is selected", async () => {
    editor.movePointerTo({ x: 550, y: 150 });

    await editor.pressKey("ArrowLeft");

    expect((await editor.drawnGlyph("A")).sidebearings).toEqual({ lsb: 99, rsb: 200 });
  });

  it("walks the halves in reading order with Tab, and back with Shift-Tab", async () => {
    await clickHalf(450);
    expect(editor.spacingTool()?.selected).toMatchObject({
      side: "left",
      gap: { left: { itemId: first } },
    });

    await editor.pressKey("Tab");
    expect(editor.spacingTool()?.selected).toMatchObject({
      side: "right",
      gap: { right: { itemId: second } },
    });
    expect(editor.canvasText()!.openItemId).toBe(second);

    await editor.pressKey("Tab");
    expect(editor.spacingTool()?.selected).toMatchObject({
      side: "left",
      gap: { left: { itemId: second } },
    });

    await editor.pressKey("Tab", { shiftKey: true });
    await editor.pressKey("Tab", { shiftKey: true });
    expect(editor.spacingTool()?.selected).toMatchObject({
      side: "left",
      gap: { left: { itemId: first } },
    });
  });

  it("clears the selection on Escape", async () => {
    await clickHalf(450);

    await editor.pressKey("Escape");

    expect(editor.spacingTool()?.selected).toBeNull();
  });

  it("edits the selected half's glyph on leaving", async () => {
    await clickHalf(550);

    editor.selectTool("select");

    expect(editor.canvasText()).toMatchObject({
      editedItemId: second,
      openItemId: second,
    });
  });
});
