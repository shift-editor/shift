import type { Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import { spacingHalfCanvasPoint } from "./fixtures/editorInteractions";

type Half = "left" | "right";

/** The gap between the run's two glyphs: after the line-start gap, before the line-end one. */
const BETWEEN = 1;

/**
 * Page position inside a gap's half, as a fraction of the line's height from its top.
 *
 * @param height - 0.5 is the middle, where the value pill sits; nearer 0 clears the pill.
 */
async function halfPagePoint(
  page: Page,
  editor: EditorDriver,
  gapIndex: number,
  side: Half,
  height = 0.5,
): Promise<Point2D> {
  const [canvas, bounds] = await Promise.all([
    spacingHalfCanvasPoint(page, gapIndex, side, height),
    editor.canvasBounds(),
  ]);
  return { x: bounds.x + canvas.x, y: bounds.y + canvas.y };
}

/** The half arrow keys nudge: its side and the text item whose sidebearing it is; null for none. */
async function selectedHalf(editor: EditorDriver): Promise<{ side: Half; itemId: string } | null> {
  const selected = (await editor.spacingTool())?.selected;
  const half = selected?.gap[selected.side];
  return selected && half ? { side: selected.side, itemId: half.itemId } : null;
}

/** A short description of the element that has keyboard focus. */
function focusedElement(page: Page): Promise<string | undefined> {
  return page.locator(":root").evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
}

/** The popover's field; the glyph sidebar has its own "Right sidebearing" fields. */
function valueField(page: Page) {
  return page.getByRole("dialog").getByLabel("Right sidebearing");
}

async function hover(editor: EditorDriver, point: Point2D): Promise<void> {
  await editor.pointerMove(point);
  await editor.flushPointerMoves();
  await editor.waitForCanvasRender();
}

test.describe("Spacing tool", () => {
  // Two A's in the canvas run, so there is a gap between glyphs.
  test.beforeEach(async ({ page, editor }) => {
    await editor.openGlyphByUnicode("41");
    await editor.selectTool("text");
    await expect(page.getByRole("textbox", { name: "Text input" })).toBeFocused();
    await page.keyboard.type("A");
    await editor.press("Escape");
    await editor.press("s");
    await expect(editor.toolButton("spacing")).toHaveAttribute("aria-pressed", "true");
    await editor.waitForCanvasRender();
  });

  test("Tab walks the spacing halves without moving focus into the chrome", async ({
    page,
    editor,
  }) => {
    // Above the pill, so the click selects the half rather than opening its value.
    const point = await halfPagePoint(page, editor, BETWEEN, "left", 0.2);
    await hover(editor, point);
    await page.mouse.click(point.x, point.y);
    const [first, second] = (await editor.canvasText())!.items;
    await expect.poll(() => selectedHalf(editor)).toEqual({ side: "left", itemId: first!.id });
    const focusedBefore = await focusedElement(page);

    await page.keyboard.press("Tab");

    await expect.poll(() => selectedHalf(editor)).toEqual({ side: "right", itemId: second!.id });
    expect(await focusedElement(page)).toBe(focusedBefore);
  });

  test("clicking a value pill opens a field, and Enter sets that sidebearing", async ({
    page,
    editor,
  }) => {
    const before = await rightSidebearing(editor);
    if (before === null) throw new Error("Expected the edited glyph's right sidebearing");
    const pill = await halfPagePoint(page, editor, BETWEEN, "left");
    await hover(editor, pill);
    await page.mouse.click(pill.x, pill.y);

    const field = valueField(page);
    await expect(field).toBeFocused();
    await field.fill(String(before + 37));
    await editor.press("Enter");

    await expect.poll(() => rightSidebearing(editor)).toBe(before + 37);
    await expect(field).toBeHidden();
  });

  test("Escape closes the value field without applying what was typed", async ({
    page,
    editor,
  }) => {
    const before = await rightSidebearing(editor);
    const pill = await halfPagePoint(page, editor, BETWEEN, "left");
    await hover(editor, pill);
    await page.mouse.click(pill.x, pill.y);

    const field = valueField(page);
    await expect(field).toBeFocused();
    await field.fill("999");
    await editor.press("Escape");

    await expect(field).toBeHidden();
    expect(await rightSidebearing(editor)).toBe(before);
  });
});

/** The open glyph's right sidebearing at the active source, in whole units; the field edits it. */
async function rightSidebearing(editor: EditorDriver): Promise<number | null> {
  const { glyph, activeSourceId } = await editor.editorView();
  const source = activeSourceId ? await editor.source({ id: activeSourceId }) : null;
  if (!glyph || !source) return null;

  const { advanceWidth, bounds } = await editor.layerOf(glyph.name, source.name);
  return bounds ? Math.round(advanceWidth - bounds.max.x) : null;
}
