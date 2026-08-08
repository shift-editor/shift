import fs from "node:fs";
import { variablePreviewTest as test, expect } from "./fixtures/perfApp";

test.describe("variable imported font projection", () => {
  test("scrubs retained glyph geometry without source reads or projection acquisition", async ({
    page,
    sourcePath,
  }) => {
    await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("imported");

    const glyphCanvas = page.getByLabel("Glyph catalog").locator("..").locator("canvas").first();
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });

    const glyphId = await page.evaluate(async () => {
      const session = window.shiftSession;
      if (!session) throw new Error("Expected imported font session");

      const entry = session.font.entryForName("A");
      if (!entry) throw new Error("Variable fixture should contain A");
      await session.font.loadGlyph(entry.id);
      window.location.hash = `#/editor/${encodeURIComponent(entry.id)}`;
      return entry.id;
    });
    await page.waitForURL(new RegExp(`#/editor/${encodeURIComponent(glyphId)}$`));

    const sceneCanvas = page.locator("#scene-canvas");
    await expect(sceneCanvas).toBeVisible();
    const slider = page.getByRole("slider").first();
    await expect(slider).toBeVisible();

    const variationSidebar = page.locator("aside").first();
    await expect(variationSidebar.getByText("Regular", { exact: true })).toHaveCount(2);
    await expect(variationSidebar.getByText("Light", { exact: true })).toBeVisible();
    await expect(variationSidebar.getByLabel("Actions for Medium")).toHaveCount(0);
    await variationSidebar.getByText("Medium", { exact: true }).click();
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
      if (!font) throw new Error("Expected imported font");

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
