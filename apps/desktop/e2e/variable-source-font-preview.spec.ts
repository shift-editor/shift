import type { Page } from "@playwright/test";
import {
  designspacePreviewTest,
  expect,
  glyphsPreviewTest,
  variablePreviewTest,
} from "./fixtures/perfApp";
import { firstAxisSlider } from "./fixtures/appLocators";

interface VariationSample {
  readonly activeSourceId: string | null;
  readonly location: readonly number[];
  readonly geometry: readonly number[];
}

async function openVariableGlyph(page: Page): Promise<string> {
  await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("preview");

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
  await expect(await firstAxisSlider(page)).toBeVisible();

  return glyphId;
}

async function variationSample(page: Page, glyphId: string): Promise<VariationSample> {
  return page.evaluate((id) => {
    const session = window.shiftSession;
    const glyph = session?.editor.glyphForId(id);
    if (!session || !glyph) throw new Error("Expected loaded variable glyph");

    return {
      activeSourceId: session.editor.activeSourceId,
      location: Array.from(session.editor.externalLocation.values()),
      geometry: Array.from(glyph.geometryAt(session.editor.externalLocation).values),
    };
  }, glyphId);
}

async function moveSliderToMiddle(page: Page): Promise<void> {
  const slider = await firstAxisSlider(page);
  const track = await slider.evaluate((input) => {
    const bounds = input.parentElement?.parentElement?.getBoundingClientRect();
    if (!bounds) throw new Error("Expected slider track");

    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  });
  await page.mouse.click(track.left + track.width / 2, track.top + track.height / 2);
}

async function expectContinuousVariablePreview(page: Page): Promise<void> {
  const glyphId = await openVariableGlyph(page);
  const slider = await firstAxisSlider(page);

  await slider.press("Home");
  const minimum = await variationSample(page, glyphId);

  for (let index = 0; index < 10; index += 1) await slider.press("ArrowRight");
  const nearMinimum = await variationSample(page, glyphId);

  await moveSliderToMiddle(page);
  const middle = await variationSample(page, glyphId);
  const middleFrame = await page.locator("#scene-canvas").screenshot();

  await slider.press("End");
  const maximum = await variationSample(page, glyphId);
  const maximumFrame = await page.locator("#scene-canvas").screenshot();

  expect(minimum.activeSourceId).toBeNull();
  expect(nearMinimum.activeSourceId).toBeNull();
  expect(nearMinimum.location).not.toEqual(minimum.location);
  expect(nearMinimum.geometry).not.toEqual(minimum.geometry);
  expect(middle.geometry).not.toEqual(minimum.geometry);
  expect(middle.geometry).not.toEqual(maximum.geometry);
  expect(maximumFrame.equals(middleFrame)).toBe(false);
}

variablePreviewTest("OpenType variables interpolate continuously", async ({ page }) => {
  await expectContinuousVariablePreview(page);
});

designspacePreviewTest("Designspace sources interpolate continuously", async ({ page }) => {
  await expectContinuousVariablePreview(page);
});

glyphsPreviewTest("Glyphs sources interpolate continuously", async ({ page }) => {
  await expectContinuousVariablePreview(page);
});
