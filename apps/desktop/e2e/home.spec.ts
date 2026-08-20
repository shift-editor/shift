import type { Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import {
  clickFirstCatalogGlyph,
  glyphCatalogCanvas,
  glyphCatalogSurface,
} from "./fixtures/appLocators";

test.describe("Home view", () => {
  test("glyph grid matches snapshot", async ({ page }) => {
    await expect(page).toHaveScreenshot("home-glyph-grid.png");
  });

  test("glyph canvas contributes rendered outlines", async ({ page }) => {
    const catalogSurface = glyphCatalogSurface(page);
    const glyphCanvas = glyphCatalogCanvas(page);
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

  test("finds encoded characters and unencoded glyph names", async ({ page }) => {
    const search = page.getByPlaceholder("Search glyphs...");
    const surface = glyphCatalogSurface(page);
    const encodedId = await page.evaluate(() => {
      const font = window.shift?.font;
      if (!font) throw new Error("Expected font");

      const handle = font.glyphHandleForUnicode(0x41);
      return font.recordForName(handle.name)?.id;
    });

    await search.fill("A");
    await expect(surface).toHaveAttribute("data-first-glyph-id", encodedId ?? "");

    await page.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.shift?.font.glyphRecords().some((glyph) => glyph.name.startsWith("newGlyph")) ??
            false,
        ),
      )
      .toBe(true);
    const unencoded = await page.evaluate(() =>
      window.shift?.font.glyphRecords().find((glyph) => glyph.name.startsWith("newGlyph")),
    );
    if (!unencoded) throw new Error("Expected unencoded glyph");

    await search.fill(unencoded.name);
    await expect(surface).toHaveAttribute("data-filtered-glyph-count", "1");
    await expect(surface).toHaveAttribute("data-first-glyph-id", unencoded.id);
  });

  test("keeps the resident grid when returning from the editor", async ({ page }) => {
    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await afterNextPaint(page);
    const initialSize = await glyphCanvas.evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));

    await clickFirstCatalogGlyph(page);
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
