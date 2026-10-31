import fs from "node:fs";
import type { ElectronApplication, Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import { variablePreviewTest as test, expect } from "./fixtures/perfApp";
import {
  firstAxisSlider,
  glyphCatalogCanvas,
  instanceRow,
  openSessionGlyphNamed,
  openVariationControls,
  sourceRow,
  variationControls,
} from "./fixtures/appLocators";
import { sessionMode } from "./fixtures/documentLifecycle";
import { rejectGlyphAcquisition } from "./fixtures/previewSession";

test.describe("variable font preview projection", () => {
  test("offers source and instance navigation without authoring actions", async ({
    page,
    editor,
    electronApp,
  }) => {
    await openPreviewGlyph(page, electronApp, "A");
    const variationSidebar = await openVariationControls(page);

    await expect(variationSidebar.getByLabel("Create source")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(sourceRow(variationControls(page), "Regular")).toBeEnabled();
    await expect(variationSidebar.getByText("Light", { exact: true })).toBeVisible();
    // Source and instance rows both expose actions; every one is unavailable in a preview.
    const rowActions = variationSidebar.getByLabel(/^Actions for (Regular|Medium)$/);
    await expect.poll(() => rowActions.count()).toBeGreaterThanOrEqual(2);
    for (const action of await rowActions.all()) {
      await expect(action).toHaveAttribute("aria-disabled", "true");
    }

    await instanceRow(variationControls(page), "Medium").click();
    await expect
      .poll(async () => {
        const [location] = (await editor.editorView()).externalLocation;
        return location;
      })
      .toMatchObject({ value: 500 });
  });

  test("scrubs retained glyph geometry without source reads or projection acquisition", async ({
    page,
    editor,
    sourcePath,
    electronApp,
  }) => {
    const glyphId = await openPreviewGlyph(page, electronApp, "A");
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
    await rejectGlyphAcquisition(page);

    await slider.press("End");
    await expect
      .poll(async () => (await glyphSample(page, glyphId)).location)
      .not.toEqual(before.location);
    expect((await glyphSample(page, glyphId)).values).not.toEqual(before.values);

    await editor.waitForCanvasRender();
    expect((await sceneCanvas.screenshot()).equals(beforeFrame)).toBe(false);
  });
});

async function openPreviewGlyph(
  page: Page,
  electronApp: ElectronApplication,
  name: string,
): Promise<GlyphId> {
  await expect.poll(() => sessionMode(page, electronApp)).toBe("preview");
  await expect(glyphCatalogCanvas(page)).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });

  return openSessionGlyphNamed(page, name);
}

async function glyphSample(
  page: Page,
  glyphId: GlyphId,
): Promise<{ location: number[]; values: number[] }> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- waits on the open-glyph refactor: reads the interpolated outline
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
