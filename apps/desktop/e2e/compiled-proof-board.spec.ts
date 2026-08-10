import path from "node:path";
import { performance as nodePerformance } from "node:perf_hooks";

import { expect, navigateToEditor, test } from "./fixtures/electronApp";

const APP_ROOT = path.resolve(__dirname, "..");
const VARIABLE_SOURCE_PATH = path.resolve(
  APP_ROOT,
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

test.use({ startupFontPath: VARIABLE_SOURCE_PATH });

test.describe("compiled proof board spike", () => {
  test("recompiles shared DOM proofs after authored edits", async ({ page }, testInfo) => {
    await navigateToEditor(page, "41");

    const setup = await page.evaluate(() => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      const axes = workspace.font.getAxes();
      if (axes.length === 0) throw new Error("Expected variable authored fixture");

      const lowValues = Object.fromEntries(
        axes.map((axis) => [axis.id, axis.minimum ?? axis.default]),
      );
      const highValues = Object.fromEntries(
        axes.map((axis) => [axis.id, axis.maximum ?? axis.default]),
      );
      const run = workspace.editor.text.createRun("FISH A");
      const low = workspace.editor.scene.createNode({
        kind: "textRun",
        runId: run.id,
        position: { x: -1_150, y: 900 },
        size: 320,
        externalLocation: { values: lowValues },
      });
      const high = workspace.editor.scene.createNode({
        kind: "textRun",
        runId: run.id,
        position: { x: 350, y: 900 },
        size: 320,
        externalLocation: { values: highValues },
      });

      return {
        runId: run.id,
        lowNodeId: low.id,
        highNodeId: high.id,
        axisTags: axes.map((axis) => axis.tag),
      };
    });

    const proofLayer = page.locator("[data-compiled-proof-layer]");
    const frames = proofLayer.locator("[data-proof-node-id]");
    await expect(frames).toHaveCount(2);
    await expect(proofLayer).toHaveAttribute("data-working-font-status", "ready", {
      timeout: 30_000,
    });
    await expect(frames.nth(0)).toHaveAttribute("data-proof-run-id", setup.runId);
    await expect(frames.nth(1)).toHaveAttribute("data-proof-run-id", setup.runId);
    await expect(frames.nth(0)).toHaveText("FISH A");
    await expect(frames.nth(1)).toHaveText("FISH A");

    const firstFamily = await proofLayer.getAttribute("data-working-font-family");
    expect(firstFamily).toBeTruthy();
    const firstMetrics = await workingFontMetrics(proofLayer);
    const styles = await frames.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          family: style.fontFamily,
          inlineFamily: (element as HTMLElement).style.fontFamily,
          variations: style.fontVariationSettings,
          fontSize: style.fontSize,
        };
      }),
    );
    for (const style of styles) {
      expect(style.inlineFamily).toContain(firstFamily!);
      expect(style.family).toContain(firstFamily!);
    }
    expect(styles[0]?.variations).not.toBe(styles[1]?.variations);
    expect(setup.axisTags).toEqual(expect.arrayContaining(["wdth", "wght"]));

    const lowImage = await frames.nth(0).screenshot();
    const highImage = await frames.nth(1).screenshot();
    expect(lowImage.equals(highImage)).toBe(false);

    const before = await frames.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, fontSize: getComputedStyle(element).fontSize };
      }),
    );
    const canvasBefore = await page.locator("#scene-canvas").screenshot();

    await page.evaluate(() => {
      const editor = window.shift?.editor;
      if (!editor) throw new Error("Expected editor");
      const pan = editor.pan;
      editor.setPan({ x: pan.x + 80, y: pan.y + 40 });
    });
    await expect
      .poll(async () => {
        const bounds = await frames.nth(0).boundingBox();
        return bounds ? Math.abs(bounds.x - before[0]!.left) : 0;
      })
      .toBeGreaterThan(10);

    const afterPan = await frames.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top };
      }),
    );
    const firstDelta = {
      x: afterPan[0]!.left - before[0]!.left,
      y: afterPan[0]!.top - before[0]!.top,
    };
    const secondDelta = {
      x: afterPan[1]!.left - before[1]!.left,
      y: afterPan[1]!.top - before[1]!.top,
    };
    expect(secondDelta.x).toBeCloseTo(firstDelta.x, 5);
    expect(secondDelta.y).toBeCloseTo(firstDelta.y, 5);

    const projectedLow = await page.evaluate((nodeId) => {
      const editor = window.shift?.editor;
      const node = editor?.scene.node(nodeId);
      if (!editor || !node) throw new Error("Expected proof node");
      return editor.projectSceneToScreen(node.position);
    }, setup.lowNodeId);
    const proofBounds = await proofLayer.boundingBox();
    if (!proofBounds) throw new Error("Expected proof layer bounds");
    expect(afterPan[0]!.left).toBeCloseTo(proofBounds.x + projectedLow.x, 5);

    const canvasAfter = await page.locator("#scene-canvas").screenshot();
    expect(canvasAfter.equals(canvasBefore)).toBe(false);

    await page.evaluate(() => window.shift?.editor.zoomIn());
    await expect
      .poll(async () =>
        Number.parseFloat(await frames.nth(0).evaluate((node) => getComputedStyle(node).fontSize)),
      )
      .toBeGreaterThan(Number.parseFloat(before[0]!.fontSize));

    const proofBeforeEdit = await frames.nth(0).screenshot();
    const recompileStarted = nodePerformance.now();
    await page.evaluate(() => {
      const workspace = window.shift;
      const node = workspace?.editor.scene.nodesOfKind("glyph")[0] ?? null;
      const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
      const layer = node ? glyph?.layerForSource(node.sourceId) : null;
      if (!layer) throw new Error("Expected active authored glyph layer");
      layer.setXAdvance(layer.xAdvance + 120);
    });

    await expect
      .poll(() => proofLayer.getAttribute("data-working-font-family"), { timeout: 30_000 })
      .not.toBe(firstFamily);
    await expect(proofLayer).toHaveAttribute("data-working-font-status", "ready");
    const editToInstalledFaceMs = nodePerformance.now() - recompileStarted;
    const proofAfterEdit = await frames.nth(0).screenshot();
    expect(proofAfterEdit.equals(proofBeforeEdit)).toBe(false);

    const updatedMetrics = await workingFontMetrics(proofLayer);
    const metrics = {
      initial: firstMetrics,
      updated: updatedMetrics,
      editToInstalledFaceMs,
    };
    for (const generation of [metrics.initial, metrics.updated]) {
      expect(generation.compiledBytes).toBeGreaterThan(0);
      expect(generation.compileMs).toBeGreaterThan(0);
      expect(generation.fontFaceLoadMs).toBeGreaterThanOrEqual(0);
      expect(generation.updateMs).toBeGreaterThan(0);
    }

    await testInfo.attach("compiled-proof-timings.json", {
      body: Buffer.from(JSON.stringify(metrics, null, 2)),
      contentType: "application/json",
    });
  });
});

async function workingFontMetrics(proofLayer: import("@playwright/test").Locator) {
  return proofLayer.evaluate((element) => ({
    compiledBytes: Number(element.getAttribute("data-working-font-bytes")),
    compileMs: Number(element.getAttribute("data-working-font-compile-ms")),
    fontFaceLoadMs: Number(element.getAttribute("data-working-font-load-ms")),
    updateMs: Number(element.getAttribute("data-working-font-update-ms")),
  }));
}
