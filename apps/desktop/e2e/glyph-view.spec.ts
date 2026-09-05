import type { Page } from "@playwright/test";
import type { GlyphId, GlyphName } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";

async function createViewGlyphs(page: Page): Promise<readonly { id: GlyphId; name: string }[]> {
  return page.evaluate(async () => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected workspace");

    const definitions = [
      { name: "viewEmpty", width: null },
      { name: "viewNarrow", width: 20 },
      { name: "viewWide", width: 1200 },
      { name: "viewExtreme", width: 5000 },
    ];
    const records = definitions.map(({ name }) => workspace.editor.createGlyph(name as GlyphName));
    await workspace.font.editCoordinator.settled();

    for (const [index, record] of records.entries()) {
      const width = definitions[index]?.width;
      const glyph = await workspace.font.loadGlyph(record.id);
      const layer = glyph.layerForSource(workspace.font.defaultSource.id);
      if (!layer) throw new Error("Expected authored layer");

      layer.setXAdvance(width ?? 500);
      if (width === null) continue;

      const contourId = layer.addContour();
      for (const point of [
        { x: 0, y: -100 },
        { x: width, y: -100 },
        { x: width, y: 900 },
        { x: 0, y: 900 },
      ]) {
        layer.addPoint(contourId, { ...point, pointType: "onCurve", smooth: false });
      }
      layer.closeContour(contourId);
    }
    await workspace.font.editCoordinator.settled();
    return records.map(({ id, name }) => ({ id, name }));
  });
}

async function cameraFrame(page: Page) {
  return page.evaluate(() => {
    const workspace = window.shift;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!workspace || !canvas) throw new Error("Expected editor canvas");

    const metrics = workspace.font.metricsAtLocation(workspace.editor.externalLocation);
    return {
      transform: workspace.editor.getCameraTransform(),
      origin: workspace.editor.projectSceneToScreen({ x: 0, y: 0 }),
      ascender: workspace.editor.projectSceneToScreen({ x: 0, y: metrics.ascender }),
      descender: workspace.editor.projectSceneToScreen({ x: 0, y: metrics.descender }),
      viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
    };
  });
}

test("keeps a useful stable UPM frame across empty and extreme glyphs", async ({ page }) => {
  const glyphs = await createViewGlyphs(page);
  const firstGlyph = glyphs[0];
  if (!firstGlyph) throw new Error("Expected view glyphs");

  await openGlyphRoute(page, firstGlyph.id);
  const expectedTransform = (await cameraFrame(page)).transform;
  await page.getByRole("button", { name: "Font overview" }).click();
  await page.waitForURL(/#\/home$/);

  for (const glyph of glyphs) {
    await openGlyphRoute(page, glyph.id);
    const frame = await cameraFrame(page);

    expect(frame.transform).toEqual(expectedTransform);
    expect(frame.origin.x).toBeGreaterThanOrEqual(0);
    expect(frame.origin.x).toBeLessThanOrEqual(frame.viewport.width);
    for (const point of [frame.ascender, frame.origin, frame.descender]) {
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(frame.viewport.height);
    }

    await page.getByRole("button", { name: "Font overview" }).click();
    await page.waitForURL(/#\/home$/);
  }
});
