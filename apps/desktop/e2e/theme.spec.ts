import { workspaceTest as test, expect } from "./fixtures/electronApp";
import {
  clickFirstCatalogGlyph,
  glyphCatalogSurface,
  waitForEditorReady,
} from "./fixtures/appLocators";

test.describe("Theme", () => {
  test("light theme home view matches snapshot", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("themeSelection", "shift-light"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "shift-light");

    await expect(page).toHaveScreenshot("theme-light-home.png");
  });

  test("selects and persists a classic color theme", async ({ page }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: /Nord/ }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
    await expect
      .poll(() =>
        page.evaluate(() => ({
          background: getComputedStyle(document.documentElement)
            .getPropertyValue("--color-background")
            .trim(),
          handle: getComputedStyle(document.documentElement)
            .getPropertyValue("--editor-handle-primary-stroke")
            .trim(),
        })),
      )
      .toEqual({ background: "#2e3440", handle: "#81a1c1" });

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
  });

  test("keeps interaction overlays reactive after returning from Home", async ({
    page,
    editor,
  }) => {
    const catalog = glyphCatalogSurface(page);
    await expect(catalog).toBeVisible();
    const glyphId = await catalog.getAttribute("data-first-glyph-id");
    if (!glyphId) throw new Error("Expected a catalog glyph");

    await clickFirstCatalogGlyph(page);
    await waitForEditorReady(page, glyphId);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: /Dracula/ }).click();
    await page.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("button", { name: "Font overview" }).click();
    await page.waitForURL(/#\/home$/);
    await expect(catalog).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    await clickFirstCatalogGlyph(page);
    await waitForEditorReady(page, glyphId);
    await editor.waitForCanvasRender();

    const scene = page.locator("#scene-canvas");
    const bounds = await editor.canvasBounds();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

    const beforePan = await scene.screenshot();
    await page.mouse.wheel(40, 30);
    await editor.waitForCanvasRender();
    expect((await scene.screenshot()).equals(beforePan)).toBe(false);

    const beforeZoom = await scene.screenshot();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await editor.waitForCanvasRender();
    expect((await scene.screenshot()).equals(beforeZoom)).toBe(false);

    const overlay = page.locator("#interactive-canvas");
    const paintedPixelCount = () =>
      overlay.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Expected overlay canvas context");

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) count++;
        }
        return count;
      });
    const before = await paintedPixelCount();

    await editor.pointerDown({ x: bounds.x + 20, y: bounds.y + 20 });
    await editor.pointerMove({ x: bounds.x + 180, y: bounds.y + 120 }, 5);

    await expect.poll(() => editor.toolState()).toBe("brushing");
    await expect.poll(paintedPixelCount).toBeGreaterThan(before);
    await editor.cancelGesture();
  });

  test("redraws the active canvas renderers when the theme changes", async ({
    electronApp,
    page,
    editor,
  }) => {
    await editor.openGlyphByUnicode("41");
    await editor.waitForCanvasRender();

    const sceneCanvas = page.locator("#scene-canvas");
    const markerCanvas = page.locator("#marker-canvas");
    const sceneScreenshotOptions = { style: "#scene-canvas { background: white; }" };
    const markerScreenshotOptions = { style: "#marker-canvas { background: white; }" };
    const sceneBefore = await sceneCanvas.screenshot(sceneScreenshotOptions);
    const markersBefore = await markerCanvas.screenshot(markerScreenshotOptions);
    const gpuMarkersVisible = await electronApp.evaluate(({ nativeImage }, png) => {
      const pixels = nativeImage.createFromBuffer(Buffer.from(png, "base64")).toBitmap();
      for (let index = 0; index < pixels.length; index += 4) {
        const blue = pixels[index]!;
        const green = pixels[index + 1]!;
        const red = pixels[index + 2]!;
        if (red < 250 || green < 250 || blue < 250) return true;
      }
      return false;
    }, markersBefore.toString("base64"));

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("radio", { name: /Nord/ }).click();
    await page.getByRole("button", { name: "Close settings" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
    await expect
      .poll(async () => (await sceneCanvas.screenshot(sceneScreenshotOptions)).equals(sceneBefore))
      .toBe(false);

    if (gpuMarkersVisible) {
      await expect
        .poll(async () =>
          (await markerCanvas.screenshot(markerScreenshotOptions)).equals(markersBefore),
        )
        .toBe(false);
    }
  });
});
