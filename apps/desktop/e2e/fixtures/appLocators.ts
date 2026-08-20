import { expect, type Page } from "@playwright/test";

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

/**
 * Waits until the requested glyph owns the visible editor scene.
 *
 * @param page - workspace window navigating to the editor.
 * @param glyphId - glyph identity that must own the published scene node.
 */
export async function waitForEditorReady(page: Page, glyphId: string): Promise<void> {
  await page.waitForURL(new RegExp(`#/editor/${encodeURIComponent(glyphId)}$`));
  await expect(editorShell(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (expectedGlyphId) =>
          window.shift?.editor.scene.nodesOfKind("glyph")[0]?.glyphId === expectedGlyphId,
        glyphId,
      ),
    )
    .toBe(true);
}

/**
 * Navigates directly to a glyph route and waits for its scene publication.
 *
 * @param page - workspace window navigating to the editor.
 * @param glyphId - glyph identity that must own the published scene node.
 */
export async function openGlyphRoute(page: Page, glyphId: string): Promise<void> {
  await page.evaluate((id) => {
    window.location.hash = `#/editor/${encodeURIComponent(id)}`;
  }, glyphId);
  await waitForEditorReady(page, glyphId);
}

export async function openCatalogGlyph(
  page: Page,
  glyphName: string,
  glyphId: string,
): Promise<void> {
  const surface = glyphCatalogSurface(page);
  await expect(surface).toBeVisible();
  await page.getByPlaceholder("Search glyphs...").fill(glyphName);
  await expect(surface).toHaveAttribute("data-filtered-glyph-count", "1");
  await expect(surface).toHaveAttribute("data-first-glyph-id", glyphId);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await clickFirstCatalogGlyph(page);
  await waitForEditorReady(page, glyphId);
}
