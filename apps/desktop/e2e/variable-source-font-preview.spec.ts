import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import {
  designspacePreviewTest,
  expect,
  glyphsPreviewTest,
  variablePreviewTest,
} from "./fixtures/perfApp";
import {
  firstAxisSlider,
  openSessionGlyphNamed,
  openVariationControls,
} from "./fixtures/appLocators";
import { sessionMode } from "./fixtures/documentLifecycle";
import type { EditorDriver } from "./fixtures/EditorDriver";

interface VariationSample {
  readonly activeSourceId: string | null;
  readonly location: readonly number[];
  readonly geometry: readonly number[];
}

async function openVariableGlyph(page: Page, electronApp: ElectronApplication): Promise<GlyphId> {
  await expect.poll(() => sessionMode(page, electronApp)).toBe("preview");

  const glyphId = await openSessionGlyphNamed(page, "A");
  await openVariationControls(page);
  await expect(await firstAxisSlider(page)).toBeVisible();

  return glyphId;
}

async function variationSample(page: Page, glyphId: GlyphId): Promise<VariationSample> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- waits on the open-glyph refactor: reads the interpolated outline
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
  const slider: Locator = await firstAxisSlider(page);
  const track = await slider.evaluate((input) => {
    const bounds = input.parentElement?.parentElement?.getBoundingClientRect();
    if (!bounds) throw new Error("Expected slider track");

    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  });
  await page.mouse.click(track.left + track.width / 2, track.top + track.height / 2);
}

/** Captures the scene layer after the latest location has been rendered. */
async function renderedSceneFrame(editor: EditorDriver): Promise<Buffer> {
  await editor.waitForCanvasRender();
  return editor.page.locator("#scene-canvas").screenshot();
}

async function expectContinuousVariablePreview(
  editor: EditorDriver,
  electronApp: ElectronApplication,
): Promise<void> {
  const page = editor.page;
  const glyphId = await openVariableGlyph(page, electronApp);
  const slider = await firstAxisSlider(page);

  await slider.press("Home");
  const minimum = await variationSample(page, glyphId);

  for (let index = 0; index < 10; index += 1) await slider.press("ArrowRight");
  const nearMinimum = await variationSample(page, glyphId);

  await moveSliderToMiddle(page);
  const middle = await variationSample(page, glyphId);
  const middleFrame = await renderedSceneFrame(editor);

  await slider.press("End");
  const maximum = await variationSample(page, glyphId);
  const maximumFrame = await renderedSceneFrame(editor);

  expect(minimum.activeSourceId).not.toBeNull();
  expect(nearMinimum.activeSourceId).toBeNull();
  expect(nearMinimum.location).not.toEqual(minimum.location);
  expect(nearMinimum.geometry).not.toEqual(minimum.geometry);
  expect(middle.geometry).not.toEqual(minimum.geometry);
  expect(middle.geometry).not.toEqual(maximum.geometry);
  expect(maximumFrame.equals(middleFrame)).toBe(false);
}

variablePreviewTest(
  "OpenType variables interpolate continuously",
  async ({ editor, electronApp }) => {
    await expectContinuousVariablePreview(editor, electronApp);
  },
);

designspacePreviewTest(
  "Designspace sources interpolate continuously",
  async ({ editor, electronApp }) => {
    await expectContinuousVariablePreview(editor, electronApp);
  },
);

glyphsPreviewTest("Glyphs sources interpolate continuously", async ({ editor, electronApp }) => {
  await expectContinuousVariablePreview(editor, electronApp);
});
