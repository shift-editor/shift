import type { Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import {
  clickFirstCatalogGlyph,
  glyphCatalogCanvas,
  glyphCatalogSvg,
  glyphCatalogSurface,
  glyphCatalogViewport,
  waitForEditorReady,
} from "./fixtures/appLocators";

test.use({ electronArgs: ["--disable-gpu"] });

test.describe("SVG glyph catalog fallback", () => {
  test("renders and opens glyphs without a GPU process", async ({ page }) => {
    const svg = glyphCatalogSvg(page);
    await expect(svg).toBeVisible({ timeout: 30_000 });
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete");
    await expect(glyphCatalogCanvas(page)).toBeHidden();
    await expect.poll(() => svg.locator("path").count()).toBeGreaterThan(0);

    const glyphId = await glyphCatalogSurface(page).getAttribute("data-first-glyph-id");
    if (!glyphId) throw new Error("Expected a visible catalog glyph");

    await clickFirstCatalogGlyph(page);
    await waitForEditorReady(page, glyphId);
  });

  test("remains interactive after scrolling away and back", async ({ page }) => {
    const svg = glyphCatalogSvg(page);
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete", { timeout: 30_000 });
    const firstPath = svg.locator("path").first();
    const initialPath = await firstPath.getAttribute("d");
    if (!initialPath) throw new Error("Expected a visible catalog path");

    await glyphCatalogViewport(page).evaluate(
      (viewport) => (viewport.scrollTop = viewport.scrollHeight),
    );
    await expect.poll(() => firstPath.getAttribute("d")).not.toBe(initialPath);
    await expect.poll(() => hasOpenButtonInViewport(page)).toBe(true);
    await glyphCatalogViewport(page).evaluate((viewport) => (viewport.scrollTop = 0));
    await expect.poll(() => firstPath.getAttribute("d")).toBe(initialPath);
    await expect.poll(() => hasOpenButtonInViewport(page)).toBe(true);

    const glyphId = await glyphCatalogSurface(page).getAttribute("data-first-glyph-id");
    if (!glyphId) throw new Error("Expected a visible catalog glyph");
    await clickFirstCatalogGlyph(page);
    await waitForEditorReady(page, glyphId);
  });
});

async function hasOpenButtonInViewport(page: Page): Promise<boolean> {
  const viewportBounds = await glyphCatalogViewport(page).boundingBox();
  if (!viewportBounds) return false;

  return glyphCatalogSvg(page)
    .getByRole("button", { name: /^Open / })
    .evaluateAll(
      (buttons, viewport) =>
        buttons.some((button) => {
          const bounds = button.getBoundingClientRect();
          return (
            bounds.bottom > viewport.y &&
            bounds.right > viewport.x &&
            bounds.top < viewport.y + viewport.height &&
            bounds.left < viewport.x + viewport.width
          );
        }),
      viewportBounds,
    );
}
