import type { Page } from "@playwright/test";

const FIRST_GLYPH_PREVIEW_POINT = { x: 50, y: 50 };

export function glyphCatalogViewport(page: Page) {
  return page.getByLabel("Glyph catalog", { exact: true });
}

export function glyphCatalogSurface(page: Page) {
  return page.getByRole("region", { name: "Glyph catalog surface", exact: true });
}

export function glyphCatalogCanvas(page: Page) {
  return page.getByTestId("glyph-catalog-canvas");
}

export function editorShell(page: Page) {
  return page.getByTestId("editor-shell");
}

export function fontNavigation(page: Page) {
  return page.getByRole("complementary", { name: "Font navigation" });
}

export function variationControls(page: Page) {
  return page.getByRole("complementary", { name: "Variation controls" });
}

export function glyphProperties(page: Page) {
  return page.getByRole("complementary", { name: "Glyph properties" });
}

export function settingsDetails(page: Page) {
  return page.getByRole("main", { name: "Settings details" });
}

export async function firstAxisSlider(page: Page) {
  const axisName = await page.evaluate(() => window.shiftSession?.catalog.axesCell.value[0]?.name);
  if (!axisName) throw new Error("Expected a variable axis");

  return page.getByRole("slider", { name: axisName, exact: true });
}

/** Keeps the canvas layout coordinate contract in one place. */
export async function clickFirstCatalogGlyph(page: Page): Promise<void> {
  await glyphCatalogViewport(page).click({ position: FIRST_GLYPH_PREVIEW_POINT });
}
