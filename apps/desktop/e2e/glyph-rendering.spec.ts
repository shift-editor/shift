/**
 * Visual snapshot tests for glyph rendering — covers handles, curves, filled
 * outlines, and distinct visual styles for on-curve vs off-curve points.
 *
 * Uses MutatorSans "S" (U+0053) which has 44 points with cubic beziers,
 * smooth/corner nodes, and off-curve handles — exercising every visual style.
 */

import { test, expect, loadFont, navigateToEditor } from "./fixtures/electronApp";
import { CanvasUtil } from "./fixtures/CanvasUtil";

// MutatorSans glyph codepoints (hex).
const GLYPH_S = "53"; // Complex cubic curves, 44 points
const GLYPH_B = "42"; // Mix of curves + straights
const GLYPH_I = "49"; // Simple straight segments
const GLYPH_Q = "51"; // Counter with curves

// ---------------------------------------------------------------------------
// S glyph — full layer snapshots
// ---------------------------------------------------------------------------

test.describe("Glyph rendering — S (cubic curves)", () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await loadFont(electronApp, page);
    await navigateToEditor(page, GLYPH_S);
  });

  test("scene canvas shows filled glyph outline", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("scene-canvas");
    await expect(screenshot).toMatchSnapshot("scene-S-filled.png");
  });

  test("handles layer shows on-curve and off-curve handles", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("gpu-handles-canvas");
    await expect(screenshot).toMatchSnapshot("handles-S-idle.png");
  });

  test("background canvas shows guides and metrics", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("background-canvas");
    await expect(screenshot).toMatchSnapshot("bg-S-guides.png");
  });

  test("composited canvas shows full glyph with handles", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-S-composited.png");
  });
});

// ---------------------------------------------------------------------------
// Selection states
// ---------------------------------------------------------------------------

test.describe("Glyph rendering — selection states", () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await loadFont(electronApp, page);
    await navigateToEditor(page, GLYPH_S);
  });

  test("select-all highlights every handle", async ({ page }) => {
    await page.keyboard.press("Meta+a");
    await page.waitForTimeout(300);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("gpu-handles-canvas");
    await expect(screenshot).toMatchSnapshot("handles-S-all-selected.png");
  });

  test("select-all shows bounding box overlay", async ({ page }) => {
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
  test.beforeEach(async ({ electronApp, page }) => {
    await loadFont(electronApp, page);
    // Use a glyph with space to draw (I is simple — few points).
    await navigateToEditor(page, GLYPH_I);
  });

  test("single on-curve point (click)", async ({ page }) => {
    // Switch to pen tool.
    await page.keyboard.press("p");
    await page.waitForTimeout(200);

    // Click once on the canvas to place a single point.
    const canvas = page.locator("#interactive-canvas");
    await canvas.click({ position: { x: 600, y: 400 } });
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-single-point.png");
  });

  test("straight line segment (two clicks)", async ({ page }) => {
    await page.keyboard.press("p");
    await page.waitForTimeout(200);

    const canvas = page.locator("#interactive-canvas");
    await canvas.click({ position: { x: 500, y: 300 } });
    await canvas.click({ position: { x: 700, y: 500 } });
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-straight-segment.png");
  });

  test("cubic curve with handles (click-drag)", async ({ page }) => {
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

  test("multiple segments — mixed straight and cubic", async ({ page }) => {
    await page.keyboard.press("p");
    await page.waitForTimeout(200);

    const canvas = page.locator("#interactive-canvas");

    // Segment 1: straight line (click → click).
    await canvas.click({ position: { x: 350, y: 500 } });
    await canvas.click({ position: { x: 500, y: 350 } });

    // Segment 2: cubic curve (click-drag from last point).
    await page.mouse.move(650, 300);
    await page.mouse.down();
    await page.mouse.move(750, 250, { steps: 5 });
    await page.mouse.up();

    // Segment 3: another straight.
    await canvas.click({ position: { x: 850, y: 500 } });
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-mixed-segments.png");
  });

  test("cubic S-curve with symmetric handles", async ({ page }) => {
    await page.keyboard.press("p");
    await page.waitForTimeout(200);

    // First anchor with handles (drag right).
    await page.mouse.move(400, 500);
    await page.mouse.down();
    await page.mouse.move(500, 500, { steps: 5 });
    await page.mouse.up();

    // Second anchor with handles (drag left) — creates S-curve.
    await page.mouse.move(700, 300);
    await page.mouse.down();
    await page.mouse.move(600, 300, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-s-curve-handles.png");
  });
});

// ---------------------------------------------------------------------------
// Multiple glyph styles
// ---------------------------------------------------------------------------

test.describe("Glyph rendering — multiple glyphs", () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await loadFont(electronApp, page);
  });

  test("B glyph — mixed curves and straights", async ({ page }) => {
    await navigateToEditor(page, GLYPH_B);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-B-composited.png");
  });

  test("I glyph — straight segments only", async ({ page }) => {
    await navigateToEditor(page, GLYPH_I);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-I-composited.png");
  });

  test("Q glyph — counter with curves", async ({ page }) => {
    await navigateToEditor(page, GLYPH_Q);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-Q-composited.png");
  });

  test("S glyph — full editor view", async ({ page }) => {
    await navigateToEditor(page, GLYPH_S);
    await expect(page).toHaveScreenshot("editor-S-full.png");
  });
});
