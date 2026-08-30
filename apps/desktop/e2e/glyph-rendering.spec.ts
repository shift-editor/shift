/**
 * Visual snapshot tests for glyph rendering — covers handles, curves, filled
 * outlines, and distinct visual styles for on-curve vs off-curve points.
 *
 * Uses MutatorSans "S" (U+0053), whose TrueType quadratic contours include
 * smooth/corner nodes and off-curve handles — exercising every visual style.
 */

import type { Page } from "@playwright/test";
import { workspaceTest as test, expect, navigateToEditor } from "./fixtures/electronApp";
import { CanvasUtil } from "./fixtures/CanvasUtil";

// MutatorSans glyph codepoints (hex).
const GLYPH_S = "53"; // Complex quadratic curves
const GLYPH_B = "42"; // Mix of curves + straights
const GLYPH_I = "49"; // Simple straight segments
const GLYPH_Q = "51"; // Counter with curves

async function glyphPointCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    if (!editor || !node) throw new Error("Expected an active glyph node");

    return editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId)?.allPoints.length ?? 0;
  });
}

// ---------------------------------------------------------------------------
// S glyph — full layer snapshots
// ---------------------------------------------------------------------------

test.describe("Glyph rendering — S (quadratic curves)", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, GLYPH_S);
  });

  test("scene canvas shows filled glyph outline", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("scene-canvas");
    await expect(screenshot).toMatchSnapshot("scene-S-filled.png");
  });

  test("handles layer shows on-curve and off-curve handles", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("marker-canvas");
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
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page, GLYPH_S);
  });

  test("select-all highlights every handle", async ({ page }) => {
    await page.keyboard.press("Meta+a");
    await page.waitForTimeout(300);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("marker-canvas");
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
  test.beforeEach(async ({ page }) => {
    // Use a glyph with space to draw (I is simple — few points).
    await navigateToEditor(page, GLYPH_I);
  });

  test("single on-curve point (click)", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    const point = await canvasUtil.interactivePagePoint({ x: 0.7, y: 0.7 });
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 1);

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot("pen-single-point.png", {
      maxDiffPixelRatio: 0,
    });
  });

  test("straight line segment (two clicks)", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    const first = await canvasUtil.interactivePagePoint({ x: 0.55, y: 0.45 });
    const second = await canvasUtil.interactivePagePoint({ x: 0.8, y: 0.8 });
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 1);
    await page.mouse.click(second.x, second.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 2);

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot("pen-straight-segment.png", {
      maxDiffPixelRatio: 0,
    });
  });

  test("preview line follows the latest on-curve endpoint after undo", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    for (const [index, x] of [0.35, 0.5, 0.65].entries()) {
      const point = await canvasUtil.interactivePagePoint({ x, y: 0.7 });
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + index + 1);
    }
    await page.evaluate(async () => window.shift?.editor.undo());
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 2);

    const preview = await canvasUtil.interactivePagePoint({ x: 0.8, y: 0.35 });
    await page.mouse.move(preview.x, preview.y);

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot("pen-preview-after-undo.png", {
      maxDiffPixelRatio: 0,
    });
  });

  test("cubic curve with handles (click-drag)", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    const first = await canvasUtil.interactivePagePoint({ x: 0.35, y: 0.7 });
    const second = await canvasUtil.interactivePagePoint({ x: 0.55, y: 0.45 });
    const handle = await canvasUtil.interactivePagePoint({ x: 0.65, y: 0.35 });
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 1);
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(handle.x, handle.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 4);

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot("pen-cubic-curve.png", {
      maxDiffPixelRatio: 0,
    });
  });

  test("cubic curve preview before pointer release", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    const first = await canvasUtil.interactivePagePoint({ x: 0.35, y: 0.7 });
    const second = await canvasUtil.interactivePagePoint({ x: 0.55, y: 0.45 });
    const handle = await canvasUtil.interactivePagePoint({ x: 0.65, y: 0.35 });
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 1);
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(handle.x, handle.y, { steps: 5 });
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 4);
    await expect
      .poll(() => page.evaluate(() => window.shift?.editor.toolCell.peek()?.state.type))
      .toBe("dragging");

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot(
      "pen-cubic-curve-drag-preview.png",
      { maxDiffPixelRatio: 0 },
    );

    await page.mouse.up();
  });

  test("smooth junction preview before consecutive curve release", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    const first = await canvasUtil.interactivePagePoint({ x: 0.4, y: 0.7 });
    const second = await canvasUtil.interactivePagePoint({ x: 0.58, y: 0.45 });
    const secondHandle = await canvasUtil.interactivePagePoint({ x: 0.68, y: 0.35 });
    const third = await canvasUtil.interactivePagePoint({ x: 0.78, y: 0.48 });
    const thirdHandle = await canvasUtil.interactivePagePoint({ x: 0.9, y: 0.38 });
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 1);
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(secondHandle.x, secondHandle.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 4);

    await page.mouse.move(third.x, third.y);
    await page.mouse.down();
    await page.mouse.move(thirdHandle.x, thirdHandle.y, { steps: 5 });
    await expect
      .poll(() => page.evaluate(() => window.shift?.editor.toolCell.peek()?.state.type))
      .toBe("dragging");

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot(
      "pen-smooth-junction-drag-preview.png",
      { maxDiffPixelRatio: 0 },
    );

    await page.mouse.up();
  });

  test("multiple segments — mixed straight and cubic", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    const first = await canvasUtil.interactivePagePoint({ x: 0.4, y: 0.8 });
    const second = await canvasUtil.interactivePagePoint({ x: 0.55, y: 0.6 });
    const third = await canvasUtil.interactivePagePoint({ x: 0.7, y: 0.45 });
    const thirdHandle = await canvasUtil.interactivePagePoint({ x: 0.82, y: 0.35 });
    const fourth = await canvasUtil.interactivePagePoint({ x: 0.92, y: 0.75 });
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 1);
    await page.mouse.click(second.x, second.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 2);
    await page.mouse.move(third.x, third.y);
    await page.mouse.down();
    await page.mouse.move(thirdHandle.x, thirdHandle.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 5);
    await page.mouse.click(fourth.x, fourth.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 6);

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot("pen-mixed-segments.png", {
      maxDiffPixelRatio: 0,
    });
  });

  test("cubic S-curve with symmetric handles", async ({ page }) => {
    const penButton = page.getByRole("button", { name: "Pen Tool (P)" });
    await penButton.click();
    await expect(penButton).toHaveAttribute("data-active", "true");

    const canvasUtil = new CanvasUtil(page);
    const initialPointCount = await glyphPointCount(page);
    const first = await canvasUtil.interactivePagePoint({ x: 0.4, y: 0.7 });
    const second = await canvasUtil.interactivePagePoint({ x: 0.58, y: 0.4 });
    const secondHandle = await canvasUtil.interactivePagePoint({ x: 0.68, y: 0.3 });
    const third = await canvasUtil.interactivePagePoint({ x: 0.82, y: 0.65 });
    const thirdHandle = await canvasUtil.interactivePagePoint({ x: 0.7, y: 0.75 });
    await page.mouse.click(first.x, first.y);
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 1);
    await page.mouse.move(second.x, second.y);
    await page.mouse.down();
    await page.mouse.move(secondHandle.x, secondHandle.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 4);

    await page.mouse.move(third.x, third.y);
    await page.mouse.down();
    await page.mouse.move(thirdHandle.x, thirdHandle.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => glyphPointCount(page)).toBe(initialPointCount + 7);

    await expect(canvasUtil.canvasContainer()).toHaveScreenshot("pen-s-curve-handles.png", {
      maxDiffPixelRatio: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Multiple glyph styles
// ---------------------------------------------------------------------------

test.describe("Glyph rendering — multiple glyphs", () => {
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
