import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect, glyphsPreviewTest, ufoPreviewTest } from "./fixtures/perfApp";
import {
  editorShell,
  firstAxisSlider,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphCatalogViewport,
  openFirstCatalogGlyph,
  openVariationControls,
} from "./fixtures/appLocators";
import { sessionMode } from "./fixtures/documentLifecycle";
import {
  catalogLocation,
  expectCompleteResidency,
  paintsGlyphs,
} from "./fixtures/glyphCatalogProbe";

async function expectRenderedGrid(page: Page, electronApp: ElectronApplication): Promise<void> {
  await expect.poll(() => sessionMode(page, electronApp)).toBe("preview");

  const viewport = glyphCatalogViewport(page);
  await viewport.waitFor({ state: "visible" });
  const canvas: Locator = glyphCatalogCanvas(page);
  await expectCompleteResidency(canvas);

  await expect.poll(() => paintsGlyphs(glyphCatalogSurface(page), canvas)).toBe(true);
}

ufoPreviewTest("UFO sources render a complete resident Grid", async ({ page, electronApp }) => {
  await expectRenderedGrid(page, electronApp);
});

glyphsPreviewTest(
  "Glyphs sources render a complete resident Grid",
  async ({ page, editor, electronApp }) => {
    await expectRenderedGrid(page, electronApp);

    const surface = glyphCatalogSurface(page);
    const beforeFrame = await surface.screenshot();
    const beforeLocation = await catalogLocation(page);

    await openFirstCatalogGlyph(page);
    await editor.waitForCanvasRender();

    const sceneCanvas = page.locator("#scene-canvas");
    const beforeSourceFrame = await sceneCanvas.screenshot();
    const variationControls = await openVariationControls(page);
    const sourceButtons = variationControls.getByRole("button", {
      name: "Regular",
      exact: true,
    });
    await expect(sourceButtons).toHaveCount(2);
    // Both sources are named Regular, so pick the second row and follow its source by id.
    const target = (await editor.fontOverview()).sources[1];
    if (!target) throw new Error("Expected a second source");
    await sourceButtons.nth(1).click();
    await expect.poll(async () => (await editor.editorView()).activeSourceId).toBe(target.id);
    await expect.poll(() => catalogLocation(page)).not.toEqual(beforeLocation);
    await expect
      .poll(async () => (await sceneCanvas.screenshot()).equals(beforeSourceFrame))
      .toBe(false);

    const slider = await firstAxisSlider(page);
    await slider.press("End");
    await slider.press("ArrowLeft");
    await expect.poll(async () => (await editor.editorView()).activeSourceId).toBeNull();
    await expect.poll(() => catalogLocation(page)).not.toEqual(beforeLocation);
    await editorShell(page).getByLabel("Font overview").click();
    await page.waitForURL(/#\/home$/);
    await expect(glyphCatalogCanvas(page)).toHaveAttribute("data-grid-readiness", "Complete");
    await expect
      .poll(async () => (await surface.screenshot()).equals(beforeFrame), { timeout: 5_000 })
      .toBe(false);
  },
);
