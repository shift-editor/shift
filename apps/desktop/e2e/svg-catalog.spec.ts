import type { Locator, Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import {
  clickFirstCatalogGlyph,
  fontNavigation,
  glyphProperties,
  glyphCatalogCanvas,
  glyphCatalogSvg,
  glyphCatalogSurface,
  glyphCatalogViewport,
  waitForEditorReady,
  glyphSearch,
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

  test("selects glyphs by click, Shift-click, ⌘-click, a dragged box and the keyboard", async ({
    page,
  }) => {
    const svg = glyphCatalogSvg(page);
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete");
    const tiles = svg.getByRole("button", { name: /^Open / });
    const selected = svg.getByRole("button", { name: /^Open /, pressed: true });
    const names = (await tiles.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    )) as string[];
    expect(names.length).toBeGreaterThanOrEqual(3);
    const selectedNames = async () =>
      selected.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));

    await tiles.nth(0).click();
    await expect.poll(selectedNames).toEqual(names.slice(0, 1));

    await tiles.nth(2).click({ modifiers: ["Shift"] });
    await expect.poll(selectedNames).toEqual(names.slice(0, 3));

    await tiles.nth(1).click({ modifiers: ["ControlOrMeta"] });
    await expect.poll(selectedNames).toEqual([names[0], names[2]]);

    // A drag from the margin left of the first glyph to the middle of the second boxes both.
    const first = (await tiles.nth(0).boundingBox())!;
    const second = (await tiles.nth(1).boundingBox())!;
    await page.mouse.move(first.x - 10, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(selectedNames).toEqual(names.slice(0, 2));

    await page.keyboard.press("ArrowRight");
    await expect.poll(selectedNames).toEqual(names.slice(2, 3));

    await page.keyboard.press("Escape");
    await expect(selected).toHaveCount(0);
  });

  test("clears the selection from either sidebar's blank space", async ({ page }) => {
    const svg = glyphCatalogSvg(page);
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete");
    const tiles = svg.getByRole("button", { name: /^Open / });
    const selected = svg.getByRole("button", { name: /^Open /, pressed: true });
    const clickBlankFoot = async (sidebar: Locator) => {
      const box = (await sidebar.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12);
    };

    for (const sidebar of [fontNavigation(page), glyphProperties(page)]) {
      await tiles.nth(0).click();
      await expect(selected).toHaveCount(1);

      await clickBlankFoot(sidebar);

      await expect(selected).toHaveCount(0);
    }
  });

  test("opens the glyph the arrow keys reached on Enter", async ({ page }) => {
    const svg = glyphCatalogSvg(page);
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete");
    const glyphId = await glyphCatalogSurface(page).getAttribute("data-first-glyph-id");
    if (!glyphId) throw new Error("Expected a visible catalog glyph");

    await svg.focus();
    await page.keyboard.press("ArrowRight");
    await expect(svg.getByRole("button", { name: /^Open /, pressed: true })).toHaveCount(1);
    await page.keyboard.press("Enter");

    await waitForEditorReady(page, glyphId);
  });

  test("fills tagged glyphs' tiles and filters the grid to a colour from the footer", async ({
    editor,
    page,
  }) => {
    const svg = glyphCatalogSvg(page);
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete");
    const tagged = await editor.createGlyphsForUnicodes([0x3042, 0x3044]);
    const tiles = svg.getByRole("button", { name: /^Open / });
    const surface = glyphCatalogSurface(page);
    const total = (await editor.glyphNames()).length;
    await expect(surface).toHaveAttribute("data-filtered-glyph-count", `${total}`);
    await expect(page.getByRole("button", { name: "Show yellow glyphs" })).toHaveCount(0);

    await editor.tagGlyphs(tagged, { kind: "named", named: "yellow" });
    await page.getByRole("button", { name: "Show yellow glyphs" }).click();
    await expect(surface).toHaveAttribute("data-filtered-glyph-count", "2");
    await expect(tiles).toHaveCount(2);
    await expect(svg.locator('[data-mark-color="yellow"]')).toHaveCount(2);

    await page.getByRole("button", { name: "Show untagged glyphs" }).click();
    await expect(surface).toHaveAttribute("data-filtered-glyph-count", `${total - 2}`);
    await expect(svg.locator('[data-mark-color="yellow"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Show untagged glyphs" }).click();
    await expect(surface).toHaveAttribute("data-filtered-glyph-count", `${total}`);
  });

  test("makes tiles as large as the footer's size slider allows", async ({ page }) => {
    const svg = glyphCatalogSvg(page);
    await expect(svg).toHaveAttribute("data-grid-readiness", "Complete");
    const firstTile = svg.getByRole("button", { name: /^Open / }).first();
    const width = async () => (await firstTile.boundingBox())?.width ?? 0;
    expect(await width()).toBeLessThan(220);

    await page.getByRole("slider", { name: "Tile size" }).focus();
    await page.keyboard.press("End");

    await expect.poll(width).toBeGreaterThanOrEqual(220);
  });

  test("shows the system character for an empty encoded glyph", async ({ editor, page }) => {
    const [name] = await editor.createGlyphsForUnicodes([0x3042]);
    if (!name) throw new Error("Expected an empty Hiragana glyph");

    await (await glyphSearch(page)).fill(name);
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

    const viewport: Locator = glyphCatalogViewport(page);
    await viewport.evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect.poll(() => firstPath.getAttribute("d")).not.toBe(initialPath);
    await expect.poll(() => hasOpenButtonInViewport(page)).toBe(true);
    await viewport.evaluate((element) => (element.scrollTop = 0));
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
