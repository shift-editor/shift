/**
 * Visual snapshot tests for glyph rendering — covers handles, curves, filled
 * outlines, and distinct visual styles for on-curve vs off-curve points.
 *
 * Uses MutatorSans "S" (U+0053), whose TrueType quadratic contours include
 * smooth/corner nodes and off-curve handles — exercising every visual style.
 */

import type { Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { CanvasUtil } from "./fixtures/CanvasUtil";

// MutatorSans glyph codepoints (hex).
const GLYPH_S = "53"; // Complex quadratic curves
const GLYPH_B = "42"; // Mix of curves + straights
const GLYPH_I = "49"; // Simple straight segments
const GLYPH_Q = "51"; // Counter with curves

async function selectedSegmentPixelCount(page: Page): Promise<number> {
  return page.locator("#scene-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Expected scene canvas context");

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] === 24 && pixels[index + 1] === 134 && pixels[index + 2] === 215) {
        count++;
      }
    }
    return count;
  });
}

test.describe("Glyph rendering — S (quadratic curves)", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_S);
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

test.describe("Glyph rendering — selection states", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_S);
  });

  test("select-all highlights every handle", async ({ page, editor }) => {
    await editor.selectAll();
    await page.waitForTimeout(300);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("marker-canvas");
    await expect(screenshot).toMatchSnapshot("handles-S-all-selected.png");
  });

  test("select-all shows bounding box overlay", async ({ page, editor }) => {
    await editor.selectAll();
    await page.waitForTimeout(300);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-S-all-selected.png");
  });
});

test.describe("Pen tool drawing — segment snapshots", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.openGlyphByUnicode(GLYPH_I);
  });

  test("single on-curve point (click)", async ({ page, editor }) => {
    await editor.selectTool("pen");
    await page.waitForTimeout(200);

    const canvas = editor.canvas;
    await canvas.click({ position: { x: 600, y: 400 } });
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-single-point.png");
  });

  test("straight line segment (two clicks)", async ({ page, editor }) => {
    await editor.selectTool("pen");
    await page.waitForTimeout(200);

    const canvas = editor.canvas;
    await canvas.click({ position: { x: 500, y: 300 } });
    await canvas.click({ position: { x: 700, y: 500 } });
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-straight-segment.png");
  });

  test("selected segment highlight hides while translating", async ({ page, editor }) => {
    const canvas = editor.canvas;
    await editor.selectTool("pen");
    await canvas.click({ position: { x: 500, y: 300 } });
    await canvas.click({ position: { x: 700, y: 500 } });
    await page.getByRole("button", { name: "Select Tool (V)" }).click();
    await canvas.click({ position: { x: 600, y: 400 } });
    await expect.poll(() => selectedSegmentPixelCount(page)).toBeGreaterThan(0);

    const bounds = await editor.canvasBounds();
    await editor.pointerDown({ x: bounds.x + 600, y: bounds.y + 400 });
    await editor.pointerMove({ x: bounds.x + 640, y: bounds.y + 440 }, 5);
    await expect.poll(() => selectedSegmentPixelCount(page)).toBe(0);
    await editor.pointerUp();
  });

  test("space preview keeps an open contour outline visible", async ({ page, editor }) => {
    await editor.selectTool("pen");

    const canvas = editor.canvas;
    await canvas.click({ position: { x: 500, y: 300 } });
    await canvas.click({ position: { x: 700, y: 500 } });
    await page.keyboard.down("Space");
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await page.keyboard.up("Space");
    await expect(screenshot).toMatchSnapshot("pen-open-contour-space-preview.png");
  });

  test("preview line follows the latest on-curve endpoint after undo", async ({ page, editor }) => {
    await editor.selectTool("pen");

    const canvas = editor.canvas;
    const bounds = await editor.canvasBounds();

    const baseline = Math.round(bounds.height * 0.7);
    await canvas.click({ position: { x: Math.round(bounds.width * 0.35), y: baseline } });
    await canvas.click({ position: { x: Math.round(bounds.width * 0.5), y: baseline } });
    await canvas.click({ position: { x: Math.round(bounds.width * 0.65), y: baseline } });
    await editor.undo();

    await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.35);
    await page.waitForTimeout(100);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-preview-after-undo.png");
  });

  test("cubic curve with handles (click-drag)", async ({ page, editor }) => {
    await editor.selectTool("pen");
    await page.waitForTimeout(200);

    await editor.canvas.click({ position: { x: 400, y: 400 } });
    await editor.pointerDown({ x: 600, y: 300 });
    await editor.pointerMove({ x: 700, y: 250 }, 5);
    await editor.pointerUp();
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-cubic-curve.png");
  });

  test("cubic curve preview before pointer release", async ({ page, editor }) => {
    await editor.selectTool("pen");
    await page.waitForTimeout(200);

    await editor.canvas.click({ position: { x: 400, y: 400 } });
    await editor.pointerDown({ x: 600, y: 300 });
    await editor.pointerMove({ x: 700, y: 250 }, 5);
    await page.waitForTimeout(100);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-cubic-curve-drag-preview.png");

    await editor.pointerUp();
  });

  test("smooth junction preview before consecutive curve release", async ({ page, editor }) => {
    await editor.selectTool("pen");
    await page.waitForTimeout(200);

    await editor.canvas.click({ position: { x: 400, y: 400 } });
    await editor.pointerDown({ x: 600, y: 300 });
    await editor.pointerMove({ x: 700, y: 250 }, 5);
    await editor.pointerUp();
    await editor.pointerDown({ x: 800, y: 300 });
    await editor.pointerMove({ x: 900, y: 250 }, 5);
    await page.waitForTimeout(100);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-smooth-junction-drag-preview.png");

    await editor.pointerUp();
  });

  test("multiple segments — mixed straight and cubic", async ({ page, editor }) => {
    await editor.selectTool("pen");

    const canvas = editor.canvas;

    // Segment 1: straight line (click → click).
    await canvas.click({ position: { x: 350, y: 500 } });
    await canvas.click({ position: { x: 500, y: 350 } });

    // Segment 2: cubic curve (click-drag from last point).
    await editor.pointerDown({ x: 650, y: 300 });
    await editor.pointerMove({ x: 750, y: 250 }, 5);
    await editor.pointerUp();

    // Segment 3: another straight, kept inside the measured canvas bounds.
    const canvasBounds = await editor.canvasBounds();

    await canvas.click({
      position: { x: Math.round(canvasBounds.width * 0.9), y: 500 },
    });
    await expect.poll(() => editor.pointCount()).toBeGreaterThanOrEqual(6);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-mixed-segments.png");
  });

  test("cubic S-curve with symmetric handles", async ({ page, editor }) => {
    await editor.selectTool("pen");
    await page.waitForTimeout(200);

    await editor.pointerDown({ x: 400, y: 500 });
    await editor.pointerMove({ x: 500, y: 500 }, 5);
    await editor.pointerUp();

    await editor.pointerDown({ x: 700, y: 300 });
    await editor.pointerMove({ x: 600, y: 300 }, 5);
    await editor.pointerUp();
    await page.waitForTimeout(300);

    const canvasUtil = new CanvasUtil(page);
    const screenshot = await canvasUtil.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("pen-s-curve-handles.png");
  });
});

test.describe("Glyph rendering — multiple glyphs", () => {
  test("B glyph — mixed curves and straights", async ({ page, editor }) => {
    await editor.openGlyphByUnicode(GLYPH_B);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-B-composited.png");
  });

  test("I glyph — straight segments only", async ({ page, editor }) => {
    await editor.openGlyphByUnicode(GLYPH_I);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-I-composited.png");
  });

  test("Q glyph — counter with curves", async ({ page, editor }) => {
    await editor.openGlyphByUnicode(GLYPH_Q);

    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("canvas-Q-composited.png");
  });

  test("S glyph — full editor view", async ({ page, editor }) => {
    await editor.openGlyphByUnicode(GLYPH_S);
    await expect(page).toHaveScreenshot("editor-S-full.png");
  });
});
