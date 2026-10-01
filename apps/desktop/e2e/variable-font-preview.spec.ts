import fs from "node:fs";
import type { Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import { variablePreviewTest as test, expect } from "./fixtures/perfApp";
import {
  firstAxisSlider,
  glyphCatalogCanvas,
  openVariationControls,
  waitForEditorReady,
} from "./fixtures/appLocators";

test.describe("variable font preview projection", () => {
  test("offers source and instance navigation without authoring actions", async ({ page }) => {
    await openPreviewGlyph(page, "A");
    const variationSidebar = await openVariationControls(page);

    await expect(variationSidebar.getByLabel("Create source")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const regularSourceId = await page.evaluate(
      () => window.shiftSession?.font.sources.find(({ name }) => name === "Regular")?.id,
    );
    if (!regularSourceId) throw new Error("Expected Regular source");
    await expect(page.getByTestId(`source-${regularSourceId}`)).toBeEnabled();
    await expect(variationSidebar.getByText("Light", { exact: true })).toBeVisible();
    // Source and instance rows both expose actions; every one is unavailable in a preview.
    const rowActions = variationSidebar.getByLabel(/^Actions for (Regular|Medium)$/);
    await expect.poll(() => rowActions.count()).toBeGreaterThanOrEqual(2);
    for (const action of await rowActions.all()) {
      await expect(action).toHaveAttribute("aria-disabled", "true");
    }

    const mediumInstanceId = await page.evaluate(
      () => window.shiftSession?.font.namedInstances.find(({ name }) => name === "Medium")?.id,
    );
    if (!mediumInstanceId) throw new Error("Expected Medium instance");
    await page.getByTestId(`instance-${mediumInstanceId}`).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.shiftSession?.editor.externalLocation.values().next().value),
      )
      .toBe(500);
  });

  test("scrubs retained glyph geometry without source reads or projection acquisition", async ({
    page,
    editor,
    sourcePath,
  }) => {
    const glyphId = await openPreviewGlyph(page, "A");
    await openVariationControls(page);
    const slider = await firstAxisSlider(page);
    await expect(slider).toBeVisible();
    await slider.press("Home");

    const before = await glyphSample(page, glyphId);
    const sceneCanvas = page.locator("#scene-canvas");
    await editor.waitForCanvasRender();
    const beforeFrame = await sceneCanvas.screenshot();

    // A removed source exposes filesystem reads; rejecting acquisition exposes any
    // attempt to rebuild the retained projection while scrubbing.
    fs.rmSync(sourcePath);
    await page.evaluate(() => {
      const font = window.shiftSession?.font;
      if (!font) throw new Error("Expected preview font");

      font.loadGlyph = async () => {
        throw new Error("variation scrub attempted glyph acquisition");
      };
      font.loadGlyphs = async () => {
        throw new Error("variation scrub attempted glyph acquisition");
      };
    });

    await slider.press("End");
    await expect
      .poll(async () => (await glyphSample(page, glyphId)).location)
      .not.toEqual(before.location);
    expect((await glyphSample(page, glyphId)).values).not.toEqual(before.values);

    await editor.waitForCanvasRender();
    expect((await sceneCanvas.screenshot()).equals(beforeFrame)).toBe(false);
  });
});

async function openPreviewGlyph(page: Page, name: string): Promise<GlyphId> {
  await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("preview");
  await expect(glyphCatalogCanvas(page)).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });

  const glyphId = await page.evaluate(async (glyphName) => {
    const session = window.shiftSession;
    if (!session) throw new Error("Expected preview font session");

    const entry = session.font.entryForName(glyphName);
    if (!entry) throw new Error(`Variable fixture should contain ${glyphName}`);
    await session.font.loadGlyph(entry.id);
    window.location.hash = `#/editor/${encodeURIComponent(entry.id)}`;
    return entry.id;
  }, name);
  await waitForEditorReady(page, glyphId);
  return glyphId;
}

async function glyphSample(
  page: Page,
  glyphId: GlyphId,
): Promise<{ location: number[]; values: number[] }> {
  return page.evaluate((selectedGlyphId) => {
    const session = window.shiftSession;
    const glyph = session?.editor.glyphForId(selectedGlyphId);
    if (!session || !glyph) throw new Error("Expected resident variable glyph");

    return {
      location: Array.from(session.editor.externalLocation.values()),
      values: Array.from(glyph.geometryAt(session.editor.externalLocation).values),
    };
  }, glyphId);
}
