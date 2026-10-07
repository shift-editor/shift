import type { Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";

type Half = "left" | "right";

/** The gap between the run's two glyphs: after the line-start gap, before the line-end one. */
const BETWEEN = 1;

/** Page position of the middle of a gap's half, where its value pill sits. */
async function halfPagePoint(
  page: Page,
  editor: EditorDriver,
  gapIndex: number,
  side: Half,
): Promise<Point2D> {
  const [canvas, bounds] = await Promise.all([
    page.evaluate(
      ({ gapIndex, side }) => {
        const editor = window.shift!.editor;
        const run = editor.scene.nodesOfKind("textRun")[0]!;
        const gap = editor.nodeDefinition("textRun").spacingGaps(run)[gapIndex]!;
        const half = gap[side]!;
        const middle = { x: (half.edge + gap.boundary) / 2, y: (gap.top + gap.bottom) / 2 };
        return editor.sceneToScreen(editor.toScene(run, middle as never));
      },
      { gapIndex, side },
    ),
    editor.canvasBounds(),
  ]);
  return { x: bounds.x + canvas.x, y: bounds.y + canvas.y };
}

/** The selected half as `side:itemIndex`, or null. */
function selectedHalf(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const state = editor.toolIf("spacing")?.state;
    const selected = state?.type === "ready" ? state.selected : null;
    const half = selected?.gap[selected.side];
    if (!selected || !half) return null;
    const run = editor.scene.nodesOfKind("textRun")[0]!;
    const items = editor.text.run(run.runId)!.items;
    return `${selected.side}:${items.findIndex((item) => item.id === half.itemId)}`;
  });
}

/** The edited `A`'s right sidebearing at the active source, in whole units. */
function rightSidebearing(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const sourceId = editor.activeSourceId;
    const node = editor.scene.nodesOfKind("glyph")[0];
    const rsb =
      node && sourceId
        ? editor.glyphForId(node.glyphId)?.layerForSource(sourceId)?.sidebearings.rsb
        : null;
    return rsb === null || rsb === undefined ? null : Math.round(rsb);
  });
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
    await editor.press("m");
    await expect(editor.toolButton("spacing")).toHaveAttribute("aria-pressed", "true");
    await editor.waitForCanvasRender();
  });

  test("Tab walks the spacing halves without moving focus into the chrome", async ({
    page,
    editor,
  }) => {
    const point = await halfPagePoint(page, editor, BETWEEN, "left");
    await hover(editor, point);
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => selectedHalf(page)).toBe("left:0");
    const focusedBefore = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));

    await page.keyboard.press("Tab");

    await expect.poll(() => selectedHalf(page)).toBe("right:1");
    expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))).toBe(
      focusedBefore,
    );
  });

  test("clicking a value pill opens a field, and Enter sets that sidebearing", async ({
    page,
    editor,
  }) => {
    const before = await rightSidebearing(page);
    if (before === null) throw new Error("Expected the edited glyph's right sidebearing");
    const pill = await halfPagePoint(page, editor, BETWEEN, "left");
    await hover(editor, pill);
    await page.mouse.click(pill.x, pill.y);

    const field = page.getByLabel("Right sidebearing");
    await expect(field).toBeFocused();
    await field.fill(String(before + 37));
    await editor.press("Enter");

    await expect.poll(() => rightSidebearing(page)).toBe(before + 37);
    await expect(field).toBeHidden();
  });

  test("Escape closes the value field without applying what was typed", async ({
    page,
    editor,
  }) => {
    const before = await rightSidebearing(page);
    const pill = await halfPagePoint(page, editor, BETWEEN, "left");
    await hover(editor, pill);
    await page.mouse.click(pill.x, pill.y);

    const field = page.getByLabel("Right sidebearing");
    await expect(field).toBeFocused();
    await field.fill("999");
    await editor.press("Escape");

    await expect(field).toBeHidden();
    expect(await rightSidebearing(page)).toBe(before);
  });
});
