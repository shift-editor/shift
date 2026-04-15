import { test, expect, loadFont, navigateToEditor } from "./fixtures/electronApp";
import { CanvasUtil } from "./fixtures/CanvasUtil";

test.describe("Editor view", () => {
  test.beforeEach(async ({ electronApp, page }) => {
    await loadFont(electronApp, page);
    // Navigate to glyph "A" (U+0041).
    await navigateToEditor(page, "41");
  });

  test("full editor matches snapshot", async ({ page }) => {
    await expect(page).toHaveScreenshot("editor-glyph-A.png");
  });

  test("composited canvas matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasContainer();
    await expect(screenshot).toMatchSnapshot("editor-canvas-A.png");
  });

  test("scene canvas layer matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("scene-canvas");
    await expect(screenshot).toMatchSnapshot("scene-canvas-A.png");
  });

  test("background canvas layer matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("background-canvas");
    await expect(screenshot).toMatchSnapshot("bg-canvas-A.png");
  });

  test("GPU handles layer matches snapshot", async ({ page }) => {
    const canvas = new CanvasUtil(page);
    const screenshot = await canvas.screenshotCanvasLayer("gpu-handles-canvas");
    await expect(screenshot).toMatchSnapshot("handles-canvas-A.png");
  });
});
