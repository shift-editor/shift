import { workspaceTest as test, expect } from "./fixtures/electronApp";

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
