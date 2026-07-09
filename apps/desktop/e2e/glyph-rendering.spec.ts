/**
 * Visual snapshot tests for glyph rendering — covers handles, curves, filled
 * outlines, and distinct visual styles for on-curve vs off-curve points.
 *
 * Uses MutatorSans "S" (U+0053) which has 44 points with cubic beziers,
 * smooth/corner nodes, and off-curve handles — exercising every visual style.
 */

import { test, expect, navigateToEditor } from "./fixtures/electronApp";
import { CanvasUtil } from "./fixtures/CanvasUtil";

// MutatorSans glyph codepoints (hex).
const GLYPH_S = "53"; // Complex cubic curves, 44 points
const GLYPH_I = "49"; // Simple straight segments

// ---------------------------------------------------------------------------
// S glyph — full layer snapshots
// ---------------------------------------------------------------------------

test.describe("Glyph rendering — S (cubic curves)", () => {
  test.beforeEach(async ({ workspacePage: page }) => {
    await navigateToEditor(page, GLYPH_S);
  });

  test("scene canvas shows filled glyph outline", async ({ workspacePage: page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("scene-canvas");
    await expect(screenshot).toMatchSnapshot("scene-S-filled.png");
  });

  test("handles layer shows on-curve and off-curve handles", async ({ workspacePage: page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("marker-canvas");
    await expect(screenshot).toMatchSnapshot("handles-S-idle.png");
  });
  test("background canvas shows guides and metrics", async ({ workspacePage: page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("background-canvas");
    await expect(screenshot).toMatchSnapshot("bg-S-guides.png");
  });
});

// ---------------------------------------------------------------------------
// Selection states
// ---------------------------------------------------------------------------

test.describe("Glyph rendering — selection states", () => {
  test.beforeEach(async ({ workspacePage: page }) => {
    await navigateToEditor(page, GLYPH_S);
  });

  test("select-all highlights every handle", async ({ workspacePage: page }) => {
    await page.keyboard.press("Meta+a");
    await page.waitForTimeout(300);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("marker-canvas");
    await expect(screenshot).toMatchSnapshot("handles-S-all-selected.png");
  });

  test("select-all shows bounding box overlay", async ({ workspacePage: page }) => {
    await page.keyboard.press("Meta+a");
    await page.waitForTimeout(300);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-S-all-selected.png");
  });
});

// ---------------------------------------------------------------------------
// Pen tool drawing — individual segment types
// ---------------------------------------------------------------------------

test.describe("Pen tool drawing — segment snapshots", () => {
  test.beforeEach(async ({ workspacePage: page }) => {
    // Use a glyph with space to draw (I is simple — few points).
    await navigateToEditor(page, GLYPH_I);
  });

  test("cubic curve with handles (click-drag)", async ({ workspacePage: page }) => {
    await page.keyboard.press("p");
    await page.waitForTimeout(200);

    const canvas = page.locator("#interactive-canvas");

    // First point: click to place on-curve.
    await canvas.click({ position: { x: 400, y: 400 } });

    // Second point: click-drag to create cubic with handles.
    await page.mouse.move(600, 300);
    await page.mouse.down();
    await page.mouse.move(700, 250, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-cubic-curve.png");
  });
});
