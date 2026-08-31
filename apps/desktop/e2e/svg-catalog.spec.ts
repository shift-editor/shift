import { workspaceTest as test, expect } from "./fixtures/electronApp";
import {
  clickFirstCatalogGlyph,
  glyphCatalogCanvas,
  glyphCatalogSvg,
  glyphCatalogSurface,
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
});
