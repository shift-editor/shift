import { expect, type Page } from "@playwright/test";

const FIRST_GLYPH_PREVIEW_POINT = { x: 50, y: 50 };
const FIRST_GLYPH_NAME_POINT = { x: 50, y: 117 };

export function glyphCatalogViewport(page: Page) {
  return page.getByLabel("Glyph catalog", { exact: true });
}

export function glyphCatalogSurface(page: Page) {
  return page.getByRole("region", { name: "Glyph catalog surface", exact: true });
}

export function glyphCatalogCanvas(page: Page) {
  return page.getByTestId("glyph-catalog-canvas");
}

export function glyphCatalogSvg(page: Page) {
  return page.getByTestId("glyph-catalog-svg");
}

export function glyphCatalogRenderer(page: Page) {
  return page.locator("[data-glyph-catalog-renderer]");
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

/** Keeps the catalog preview coordinate contract in one place. */
export async function clickFirstCatalogGlyph(page: Page): Promise<void> {
  await glyphCatalogViewport(page).click({ position: FIRST_GLYPH_PREVIEW_POINT });
}

/** Keeps the catalog name-cell coordinate contract in one place. */
export async function clickFirstCatalogGlyphName(page: Page): Promise<void> {
  await glyphCatalogViewport(page).click({ position: FIRST_GLYPH_NAME_POINT });
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
 * Acquires a glyph, navigates to its editor route, and waits for scene publication.
 *
 * @param page - authored or preview workspace window navigating to the editor.
 * @param glyphId - catalog identity to acquire before publishing the route.
 * @throws {Error} when the workspace is unavailable or glyph acquisition fails.
 */
export async function openGlyphRoute(page: Page, glyphId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected font workspace");

    await font.loadGlyph(id);
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
  await expect(glyphCatalogRenderer(page)).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });
  await clickFirstCatalogGlyph(page);
  await waitForEditorReady(page, glyphId);
}
