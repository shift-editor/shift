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

  test("shows the system character for an empty encoded glyph", async ({ page }) => {
    const name = await page.evaluate(async () => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      const [glyph] = workspace.editor.createGlyphsForUnicodes([0x3042]);
      if (!glyph) throw new Error("Expected an empty Hiragana glyph");
      await workspace.font.editCoordinator.settled();
      return glyph.name;
    });

    await page.getByPlaceholder("Search glyphs...").fill(name);
    const svg = glyphCatalogSvg(page);
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete");
    const tile = svg.getByRole("button", { name: /^Open / }).filter({ hasText: "あ" });
    await expect(tile).toHaveCount(1);
    await expect(tile.locator("path")).toHaveCount(0);
  });

  test("selects and deselects Chinese missing glyphs across the list", async ({ page }) => {
    await page.getByRole("button", { name: "Chinese", exact: true }).click();
    const language = page.getByRole("button", { name: /Mandarin Chinese/ });
    await language.click({ button: "right" });
    const list = page.getByRole("group", { name: "Missing glyphs for Mandarin Chinese" });
    await expect(list).toBeVisible();
    const checkboxes = list.getByRole("checkbox");

    await page.getByRole("button", { name: "Select All" }).click();
    await expect(page.getByRole("button", { name: "Deselect All" })).toBeVisible();
    await expect(checkboxes.first()).toBeChecked();
    const firstName = await list.locator("label").first().textContent();
    await list.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect.poll(() => list.locator("label").first().textContent()).not.toBe(firstName);
    await expect(checkboxes.first()).toBeChecked();

    await page.getByRole("button", { name: "Deselect All" }).click();
    await expect(checkboxes.first()).not.toBeChecked();
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
