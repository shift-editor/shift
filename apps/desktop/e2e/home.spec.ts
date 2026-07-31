import type { Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";

test.describe("Home view", () => {
  test("glyph grid matches snapshot", async ({ page }) => {
    await expect(page).toHaveScreenshot("home-glyph-grid.png");
  });

  test("glyph canvas contributes rendered outlines", async ({ page }) => {
    const scrollViewport = page.getByLabel("Glyph catalog");
    const catalogSurface = scrollViewport.locator("..");
    const glyphCanvas = catalogSurface.locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });

    const renderedFrame = await catalogSurface.screenshot();
    const visibility = await glyphCanvas.evaluate((canvas) => {
      const previous = canvas.style.visibility;
      canvas.style.visibility = "hidden";
      return previous;
    });
    const frameWithoutGlyphs = await catalogSurface.screenshot();
    await glyphCanvas.evaluate((canvas, previous) => {
      canvas.style.visibility = previous;
    }, visibility);

    expect(renderedFrame.equals(frameWithoutGlyphs)).toBe(false);
  });

  test("keeps the resident grid when returning from the editor", async ({ page }) => {
    const scrollViewport = page.getByLabel("Glyph catalog");
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    const initialSize = await glyphCanvas.evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));

    await scrollViewport.click({ position: { x: 50, y: 50 } });
    await page.waitForURL(/#\/editor\//);
    await afterNextPaint(page);

    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
      )
      .toEqual(initialSize);

    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await afterNextPaint(page);

    await expect(glyphCanvas).toBeVisible();
    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
      )
      .toEqual(initialSize);
  });
});

async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
