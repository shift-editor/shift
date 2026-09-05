import type { Page } from "@playwright/test";
import { expect, glyphsPreviewTest, ufoPreviewTest } from "./fixtures/perfApp";
import {
  clickFirstCatalogGlyph,
  editorShell,
  firstAxisSlider,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphCatalogViewport,
  variationControls,
} from "./fixtures/appLocators";

async function expectRenderedGrid(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("preview");

  const viewport = glyphCatalogViewport(page);
  await viewport.waitFor({ state: "visible" });
  const canvas = glyphCatalogCanvas(page);
  await expect(canvas).toHaveAttribute("data-grid-readiness", "Complete", { timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-fully-resident", "true");

  const counts = await canvas.evaluate((element) => ({
    resident: Number(element.dataset.residentGlyphCount),
    target: Number(element.dataset.targetGlyphCount),
  }));
  expect(counts.resident).toBeGreaterThan(0);
  expect(counts.resident).toBe(counts.target);

  const surface = glyphCatalogSurface(page);
  await expect
    .poll(async () => {
      const rendered = await surface.screenshot();
      const visibility = await canvas.evaluate((element) => element.style.visibility);
      try {
        await canvas.evaluate((element) => {
          element.style.visibility = "hidden";
        });
        const withoutGlyphs = await surface.screenshot();
        return rendered.equals(withoutGlyphs);
      } finally {
        await canvas.evaluate((element, value) => {
          element.style.visibility = value;
        }, visibility);
      }
    })
    .toBe(false);
}

ufoPreviewTest("UFO sources render a complete resident Grid", async ({ page }) => {
  await expectRenderedGrid(page);
});

glyphsPreviewTest("Glyphs sources render a complete resident Grid", async ({ page }) => {
  await expectRenderedGrid(page);

  const surface = glyphCatalogSurface(page);
  const beforeFrame = await surface.screenshot();
  const beforeLocation = await page.evaluate(() => window.shiftSession?.catalog.locationCell.value);

  await clickFirstCatalogGlyph(page);
  await page.waitForURL(/#\/editor\//);

  const sceneCanvas = page.locator("#scene-canvas");
  const beforeSourceFrame = await sceneCanvas.screenshot();
  const sourceButtons = variationControls(page).getByRole("button", {
    name: "Regular",
    exact: true,
  });
  await expect(sourceButtons).toHaveCount(2);
  const targetSourceId = await page.evaluate(() => window.shiftSession?.font.sources[1]?.id);
  if (!targetSourceId) throw new Error("Expected a second source");
  await page.getByTestId(`source-${targetSourceId}`).click();
  await expect
    .poll(() => page.evaluate(() => window.shiftSession?.editor.activeSourceId))
    .toBe(targetSourceId);
  await expect
    .poll(() => page.evaluate(() => window.shiftSession?.catalog.locationCell.value))
    .toEqual(beforeLocation);
  await expect
    .poll(async () => (await sceneCanvas.screenshot()).equals(beforeSourceFrame))
    .toBe(false);

  await (await firstAxisSlider(page)).press("End");
  await expect
    .poll(() => page.evaluate(() => window.shiftSession?.editor.activeSourceId))
    .toBeNull();
  await expect
    .poll(() => page.evaluate(() => window.shiftSession?.catalog.locationCell.value))
    .not.toEqual(beforeLocation);
  await editorShell(page).getByLabel("Font overview").click();
  await page.waitForURL(/#\/home$/);
  await expect(glyphCatalogCanvas(page)).toHaveAttribute("data-grid-readiness", "Complete");
  await expect
    .poll(async () => (await surface.screenshot()).equals(beforeFrame), { timeout: 5_000 })
    .toBe(false);
});
