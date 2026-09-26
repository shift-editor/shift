import type { Page } from "@playwright/test";
import type { GlyphId, GlyphName } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";

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

test("keeps the reported wheel position anchored across the full zoom range", async ({
  page,
  editor,
}) => {
  const glyphs = await createViewGlyphs(page);
  const glyph = glyphs[2];
  if (!glyph) throw new Error("Expected a glyph with handles");

  await editor.openGlyph(glyph.id);
  await expect(editor.canvas).toBeVisible();

  const point = (await editor.outline())[0]?.points[0];
  if (!point) throw new Error("Expected glyph point");
  const target = (await editor.pointTargets([point.id]))[0];
  if (!target) throw new Error("Expected glyph point target");
  const screen = {
    x: Math.round(target.canvasPosition.x),
    y: Math.round(target.canvasPosition.y),
  };
  const scene = await editor.projectCanvasToScene(screen);
  const anchor = {
    screen,
    scene,
    client: await editor.projectSceneToPage(scene),
  };

  for (let index = 0; index < 60; index++) {
    await editor.canvas.dispatchEvent("wheel", {
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
  const projected = await editor.projectSceneToCanvas(anchor.scene);
  expect(projected.x).toBeCloseTo(anchor.screen.x, 6);
  expect(projected.y).toBeCloseTo(anchor.screen.y, 6);
});

test("does not turn released-modifier zoom momentum into pan", async ({ page, editor }) => {
  const glyphs = await createViewGlyphs(page);
  const glyph = glyphs[2];
  if (!glyph) throw new Error("Expected a glyph with handles");

  await editor.openGlyph(glyph.id);
  await editor.waitForCanvasRender();

  // Samples are dispatched synchronously in the page so their timestamps, not Playwright
  // round trips, decide whether the modifier-free sample continues the zoom gesture.
  const gesture = await editor.canvas.evaluate((canvas) => {
    const editorState = window.shift?.editor;
    if (!editorState) throw new Error("Expected editor");

    const bounds = canvas.getBoundingClientRect();
    const wheel = (init: WheelEventInit) =>
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          deltaMode: 0,
          ...init,
        }),
      );

    wheel({ ctrlKey: true, deltaY: -100 });
    const zoomPan = editorState.pan;
    const zoomedAt = performance.now();
    wheel({ deltaX: 30, deltaY: 0 });
    return { zoomPan, momentumPan: editorState.pan, zoomedAt };
  });
  expect(gesture.momentumPan).toEqual(gesture.zoomPan);

  // Elapsed time is the contract: wait on the page clock that stamps wheel events.
  await page.waitForFunction((zoomedAt) => performance.now() - zoomedAt > 250, gesture.zoomedAt);
  const bounds = await editor.canvasBounds();
  await editor.canvas.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: Math.round(bounds.x + bounds.width / 2),
    clientY: Math.round(bounds.y + bounds.height / 2),
    deltaMode: 0,
    deltaX: 30,
    deltaY: 0,
  });
  expect((await page.evaluate(() => window.shift?.editor.pan))?.x).toBe(gesture.zoomPan.x - 30);
});

test("keeps a useful UPM frame across empty and extreme glyphs", async ({ page, editor }) => {
  const glyphs = await createViewGlyphs(page);

  for (const glyph of glyphs) {
    await editor.openGlyph(glyph.id);
    await expect(editor.canvas).toBeVisible();
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
