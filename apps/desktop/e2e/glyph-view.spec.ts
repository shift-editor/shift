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
      advance: workspace.editor.projectSceneToScreen({ x: workspace.editor.xAdvance, y: 0 }),
      ascender: workspace.editor.projectSceneToScreen({ x: 0, y: metrics.ascender }),
      descender: workspace.editor.projectSceneToScreen({ x: 0, y: metrics.descender }),
      viewport: { width: canvas.clientWidth, height: canvas.clientHeight },
    };
  });
}

test("keeps the reported wheel position anchored across the full zoom range", async ({ page }) => {
  const glyphs = await createViewGlyphs(page);
  const glyph = glyphs[2];
  if (!glyph) throw new Error("Expected a glyph with handles");

  await openGlyphRoute(page, glyph.id);
  const interactiveCanvas = page.locator("#interactive-canvas");
  await expect(interactiveCanvas).toBeVisible();

  const anchor = await page.evaluate(() => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!editor || !node || !canvas) throw new Error("Expected editor canvas");

    const point = editor
      .glyphForId(node.glyphId)
      ?.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell).allPoints[0];
    if (!point) throw new Error("Expected glyph point");

    const handle = editor.projectSceneToScreen({
      x: point.x + node.position.x,
      y: point.y + node.position.y,
    });
    const screen = { x: Math.round(handle.x), y: Math.round(handle.y) };
    const scene = editor.projectScreenToScene(screen);
    const rect = canvas.getBoundingClientRect();
    return {
      scene,
      screen,
      client: { x: rect.left + screen.x, y: rect.top + screen.y },
    };
  });

  for (let index = 0; index < 60; index++) {
    await interactiveCanvas.dispatchEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: anchor.client.x,
      clientY: anchor.client.y,
      ctrlKey: true,
      deltaMode: 0,
      deltaY: -100,
    });
  }

  await expect.poll(() => page.evaluate(() => window.shift?.editor.zoom)).toBe(32);
  const projected = await page.evaluate(
    (scene) => window.shift?.editor.projectSceneToScreen(scene),
    anchor.scene,
  );
  expect(projected?.x).toBeCloseTo(anchor.screen.x, 6);
  expect(projected?.y).toBeCloseTo(anchor.screen.y, 6);
});

test("does not turn released-modifier zoom momentum into pan", async ({ page }) => {
  const glyphs = await createViewGlyphs(page);
  const glyph = glyphs[2];
  if (!glyph) throw new Error("Expected a glyph with handles");

  await openGlyphRoute(page, glyph.id);
  const canvas = page.locator("#interactive-canvas");
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected canvas bounds");
  const event = {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(bounds.x + bounds.width / 2),
    clientY: Math.round(bounds.y + bounds.height / 2),
    deltaMode: 0,
  };

  await canvas.dispatchEvent("wheel", { ...event, ctrlKey: true, deltaY: -100 });
  const zoomPan = await page.evaluate(() => window.shift?.editor.pan);
  await canvas.dispatchEvent("wheel", { ...event, deltaX: 30, deltaY: 0 });
  expect(await page.evaluate(() => window.shift?.editor.pan)).toEqual(zoomPan);

  await page.waitForTimeout(150);
  await canvas.dispatchEvent("wheel", { ...event, deltaX: 30, deltaY: 0 });
  expect((await page.evaluate(() => window.shift?.editor.pan))?.x).toBe((zoomPan?.x ?? 0) - 30);
});

test("keeps a useful UPM frame across empty and extreme glyphs", async ({ page }) => {
  const glyphs = await createViewGlyphs(page);

  for (const glyph of glyphs) {
    await openGlyphRoute(page, glyph.id);
    await expect(page.locator("#interactive-canvas")).toBeVisible();
    const frame = await cameraFrame(page);

    const context = `${glyph.name}: ${JSON.stringify(frame)}`;
    for (const point of [frame.origin, frame.advance]) {
      expect(point.x, context).toBeGreaterThanOrEqual(0);
      expect(point.x, context).toBeLessThanOrEqual(frame.viewport.width);
    }
    for (const point of [frame.ascender, frame.origin, frame.descender]) {
      expect(point.y, context).toBeGreaterThanOrEqual(0);
      expect(point.y, context).toBeLessThanOrEqual(frame.viewport.height);
    }

    await page.getByRole("button", { name: "Font overview" }).click();
    await page.waitForURL(/#\/home$/);
  }
});
