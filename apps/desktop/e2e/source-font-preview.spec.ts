import type { Page } from "@playwright/test";
import { expect, glyphsPreviewTest, ufoPreviewTest } from "./fixtures/perfApp";

async function expectRenderedGrid(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("imported");

  const viewport = page.getByLabel("Glyph catalog");
  await viewport.waitFor({ state: "visible" });
  const canvas = viewport.locator("..").locator("canvas").first();
  await expect(canvas).toHaveAttribute("data-grid-readiness", "Complete", { timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-fully-resident", "true");

  const counts = await canvas.evaluate((element) => ({
    resident: Number(element.dataset.residentGlyphCount),
    target: Number(element.dataset.targetGlyphCount),
  }));
  expect(counts.resident).toBeGreaterThan(0);
  expect(counts.resident).toBe(counts.target);

  const surface = viewport.locator("..");
  const rendered = await surface.screenshot();
  const visibility = await canvas.evaluate((element) => element.style.visibility);
  try {
    await canvas.evaluate((element) => {
      element.style.visibility = "hidden";
    });
    const withoutGlyphs = await surface.screenshot();
    expect(rendered.equals(withoutGlyphs)).toBe(false);
  } finally {
    await canvas.evaluate((element, value) => {
      element.style.visibility = value;
    }, visibility);
  }
}

ufoPreviewTest("UFO sources render a complete resident Grid", async ({ page }) => {
  await expectRenderedGrid(page);
});

glyphsPreviewTest("Glyphs sources render a complete resident Grid", async ({ page }) => {
  await expectRenderedGrid(page);

  const viewport = page.getByLabel("Glyph catalog");
  const surface = viewport.locator("..");
  const beforeFrame = await surface.screenshot();
  const beforeLocation = await page.evaluate(() => window.shiftSession?.catalog.locationCell.value);

  await viewport.click({ position: { x: 50, y: 50 } });
  await page.waitForURL(/#\/editor\//);
  await page.getByRole("slider").first().press("End");
  await expect
    .poll(() => page.evaluate(() => window.shiftSession?.catalog.locationCell.value))
    .not.toEqual(beforeLocation);
  await page.locator(".shift-editor-shell").getByLabel("Display all glyphs").click();
  await page.waitForURL(/#\/home$/);
  await expect(surface.locator("canvas").first()).toHaveAttribute(
    "data-grid-readiness",
    "Complete",
  );
  await expect
    .poll(async () => (await surface.screenshot()).equals(beforeFrame), { timeout: 5_000 })
    .toBe(false);
});
