import fs from "node:fs";
import { variablePreviewTest as test, expect } from "./fixtures/perfApp";
import { firstAxisSlider, glyphCatalogCanvas, openVariationControls } from "./fixtures/appLocators";

test.describe("variable font preview projection", () => {
  test("scrubs retained glyph geometry without source reads or projection acquisition", async ({
    page,
    sourcePath,
  }) => {
    await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("preview");

    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });

    const glyphId = await page.evaluate(async () => {
      const session = window.shiftSession;
      if (!session) throw new Error("Expected preview font session");

      const entry = session.font.entryForName("A");
      if (!entry) throw new Error("Variable fixture should contain A");
      await session.font.loadGlyph(entry.id);
      window.location.hash = `#/editor/${encodeURIComponent(entry.id)}`;
      return entry.id;
    });
    await page.waitForURL(new RegExp(`#/editor/${encodeURIComponent(glyphId)}$`));

    const sceneCanvas = page.locator("#scene-canvas");
    await expect(sceneCanvas).toBeVisible();
    const variationSidebar = await openVariationControls(page);
    const slider = await firstAxisSlider(page);
    await expect(slider).toBeVisible();

    const createSource = variationSidebar.getByLabel("Create source");
    await expect(createSource).toHaveCSS("opacity", "0");
    await createSource.locator("..").locator("..").hover();
    await expect(createSource).toHaveCSS("opacity", "0.5");
    await expect(variationSidebar.getByText("Regular", { exact: true })).toHaveCount(2);
    const regularSourceId = await page.evaluate(
      () => window.shiftSession?.font.sources.find(({ name }) => name === "Regular")?.id,
    );
    if (!regularSourceId) throw new Error("Expected Regular source");
    const regularSource = page.getByTestId(`source-${regularSourceId}`);
    await expect(regularSource).toBeEnabled();
    const regularSourceRow = regularSource.locator("..");
    const regularSourceActions = regularSourceRow.getByLabel("Actions for Regular");
    await expect(regularSourceActions).toHaveAttribute("aria-disabled", "true");
    await expect(regularSourceActions).toHaveCSS("opacity", "0");
    await regularSource.hover();
    await expect(regularSourceActions).toHaveCSS("opacity", "0.5");
    await expect(variationSidebar.getByText("Light", { exact: true })).toBeVisible();
    await expect(variationSidebar.getByLabel("Actions for Medium")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
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
    await page.evaluate(() => window.shiftSession?.editor.setSourceToDefault());

    const before = await page.evaluate((selectedGlyphId) => {
      const session = window.shiftSession;
      const glyph = session?.editor.glyphForId(selectedGlyphId);
      if (!session || !glyph) throw new Error("Expected resident variable glyph");

      return {
        location: Array.from(session.editor.externalLocation.values()),
        values: Array.from(glyph.geometryAt(session.editor.externalLocation).values),
      };
    }, glyphId);
    const beforeFrame = await sceneCanvas.screenshot();

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
      .poll(() =>
        slider.evaluate((input) => {
          const thumbBounds = input.parentElement?.getBoundingClientRect();
          const controlBounds =
            input.parentElement?.parentElement?.parentElement?.getBoundingClientRect();
          if (!thumbBounds || !controlBounds) return false;

          return thumbBounds.left >= controlBounds.left && thumbBounds.right <= controlBounds.right;
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(window.shiftSession?.editor.externalLocation.values() ?? []),
        ),
      )
      .not.toEqual(before.location);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    const afterValues = await page.evaluate((selectedGlyphId) => {
      const session = window.shiftSession;
      const glyph = session?.editor.glyphForId(selectedGlyphId);
      if (!session || !glyph) throw new Error("Expected resident variable glyph");

      return Array.from(glyph.geometryAt(session.editor.externalLocation).values);
    }, glyphId);
    expect(afterValues).not.toEqual(before.values);

    const afterFrame = await sceneCanvas.screenshot();
    expect(afterFrame.equals(beforeFrame)).toBe(false);
  });
});
