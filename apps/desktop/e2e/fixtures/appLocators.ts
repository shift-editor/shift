import { expect, type Locator, type Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import { hooksOf, readsOf } from "./appHooks";

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

/** Toolbar holding the editor's tool buttons. */
export function editorToolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Editor tools" });
}

/** Element compositing the background, scene, marker, and interactive editor canvases. */
export function editorCanvasStack(page: Page) {
  return page.getByTestId("editor-canvas-stack");
}

export function fontNavigation(page: Page) {
  return page.getByRole("complementary", { name: "Font navigation" });
}

export function editorSidebar(page: Page) {
  return page.getByRole("complementary", { name: "Glyph objects and variations" });
}

export function variationControls(page: Page) {
  return editorSidebar(page).getByRole("tabpanel", { name: "Variations" });
}

/** The Variations panel's row for the source named `name`, as a screen reader finds it. */
export function sourceRow(controls: Locator, name: string): Locator {
  return controls
    .getByRole("group", { name: "Sources" })
    .getByRole("button", { name, exact: true });
}

/** The Variations panel's row for the named instance `name`, as a screen reader finds it. */
export function instanceRow(controls: Locator, name: string): Locator {
  return controls
    .getByRole("group", { name: "Instances" })
    .getByRole("button", { name, exact: true });
}

export async function openVariationControls(page: Page) {
  const sidebar = editorSidebar(page);
  await sidebar.getByRole("tab", { name: "Variations", exact: true }).click();
  return variationControls(page);
}

export function glyphProperties(page: Page) {
  return page.getByRole("complementary", { name: "Glyph properties" });
}

export function settingsDetails(page: Page) {
  return page.getByRole("main", { name: "Settings details" });
}

export async function firstAxisSlider(page: Page) {
  const axisName = await hooksOf(page).session.firstCatalogAxisName();
  if (!axisName) throw new Error("Expected a variable axis");

  return page.getByRole("slider", { name: axisName, exact: true });
}

/**
 * Waits until the catalog has laid out its first cell and its preview frame has settled.
 *
 * @remarks
 * Catalog cells have no DOM identity, so coordinate clicks before the Grid settles can land on
 * an empty surface and never navigate. `Unavailable` is settled too: cells remain laid out and
 * clickable when a host cannot paint previews, as on software-rendered platform runners.
 */
async function waitForCatalogCells(page: Page): Promise<void> {
  await expect(glyphCatalogSurface(page)).toHaveAttribute("data-first-glyph-id", /.+/);
  await expect(glyphCatalogRenderer(page)).toHaveAttribute(
    "data-grid-readiness",
    /^(Complete|Unavailable)$/,
    { timeout: 30_000 },
  );
}

/** Keeps the catalog preview coordinate contract in one place. */
export async function clickFirstCatalogGlyph(page: Page): Promise<void> {
  await waitForCatalogCells(page);
  await glyphCatalogViewport(page).click({ position: FIRST_GLYPH_PREVIEW_POINT });
}

/** Keeps the catalog name-cell coordinate contract in one place. */
export async function clickFirstCatalogGlyphName(page: Page): Promise<void> {
  await waitForCatalogCells(page);
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
    .poll(async () => (await readsOf(page).editor.inspect("")).glyph?.glyphId)
    .toBe(glyphId);
}

/**
 * Opens the first catalog glyph through the catalog surface.
 *
 * @param page - authored or preview workspace window showing the catalog.
 * @returns the glyph identity in the editor route it opened.
 */
export async function openFirstCatalogGlyph(page: Page): Promise<GlyphId> {
  await clickFirstCatalogGlyph(page);
  await page.waitForURL(/#\/editor\//);
  await waitForEditorReady(
    page,
    decodeURIComponent(new URL(page.url()).hash.slice("#/editor/".length)),
  );
  return (await readsOf(page).editor.inspect("")).glyph!.glyphId;
}

/**
 * Acquires a glyph, navigates to its editor route, and waits for scene publication.
 *
 * @param page - authored or preview workspace window navigating to the editor.
 * @param glyphId - catalog identity to acquire before publishing the route.
 * @throws {Error} when the workspace is unavailable or glyph acquisition fails.
 */
export async function openGlyphRoute(page: Page, glyphId: GlyphId): Promise<void> {
  await hooksOf(page).session.openGlyph(glyphId);
  await waitForEditorReady(page, glyphId);
}

/**
 * Acquires the glyph named `name` in the window's font session (authored or preview), navigates
 * to its editor route, and waits for scene publication.
 *
 * @returns the glyph's identity.
 * @throws {Error} when the session has no glyph named `name`.
 */
export async function openSessionGlyphNamed(page: Page, name: string): Promise<GlyphId> {
  const glyphId = await hooksOf(page).session.openGlyphNamed(name);
  await waitForEditorReady(page, glyphId);
  return glyphId;
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

/** The width `element` takes on the page now, in CSS pixels; 0 while it is not rendered. */
export async function elementWidth(element: Locator): Promise<number> {
  return (await element.boundingBox())?.width ?? 0;
}
