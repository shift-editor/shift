import { performance as nodePerformance } from "node:perf_hooks";

import { expect, navigateToEditor, test } from "./fixtures/electronApp";

const BENCH_FONT_PATH = process.env.SHIFT_PROOF_BENCH_FONT;

// Manual corpus benchmark; intentionally skipped in normal E2E runs.
// SHIFT_PROOF_BENCH_FONT=/path/to/font.ttf pnpm --filter @shift/desktop exec playwright test \
//   e2e/compiled-proof-board-large-font.spec.ts --project=visual

test.use({ startupFontPath: BENCH_FONT_PATH });
test.skip(!BENCH_FONT_PATH, "Set SHIFT_PROOF_BENCH_FONT to an authored-importable font");

test("measures an in-place compiled proof refresh for a large font", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  await navigateToEditor(page, "41");

  const glyphCount = await page.evaluate(() => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected workspace");

    const run = workspace.editor.text.createRun("AAAA");
    workspace.editor.scene.createNode({
      kind: "textRun",
      runId: run.id,
      position: { x: -600, y: 700 },
      size: 280,
      externalLocation: { values: {} },
    });
    return workspace.font.glyphEntries().length;
  });

  const proofLayer = page.locator("[data-compiled-proof-layer]");
  const proofFrame = proofLayer.locator("[data-proof-node-id]");
  await expect(proofFrame).toHaveCount(1);
  await expect(proofLayer).toHaveAttribute("data-working-font-status", "ready", {
    timeout: 300_000,
  });

  const initialFamily = await proofLayer.getAttribute("data-working-font-family");
  expect(initialFamily).toBeTruthy();
  const initial = await workingFontMetrics(proofLayer);
  const frameBefore = await proofFrame.evaluate((element) => {
    (element as HTMLElement).dataset.benchIdentity = "same-element";
    return {
      width: element.getBoundingClientRect().width,
      family: getComputedStyle(element).fontFamily,
    };
  });
  expect(frameBefore.family).toContain(initialFamily!);

  const editStarted = nodePerformance.now();
  await page.evaluate(() => {
    const workspace = window.shift;
    const node = workspace?.editor.scene.nodesOfKind("glyph")[0] ?? null;
    const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
    const layer = node ? glyph?.layerForSource(node.sourceId) : null;
    if (!layer) throw new Error("Expected active authored glyph layer");
    layer.setXAdvance(layer.xAdvance + 120);
  });

  await expect
    .poll(() => proofLayer.getAttribute("data-working-font-family"), { timeout: 300_000 })
    .not.toBe(initialFamily);
  await expect(proofLayer).toHaveAttribute("data-working-font-status", "ready");
  const editToObservedInstallMs = nodePerformance.now() - editStarted;
  const updatedFamily = await proofLayer.getAttribute("data-working-font-family");
  const updated = await workingFontMetrics(proofLayer);
  const frameAfter = await proofFrame.evaluate((element) => ({
    identity: (element as HTMLElement).dataset.benchIdentity,
    width: element.getBoundingClientRect().width,
    family: getComputedStyle(element).fontFamily,
  }));

  expect(frameAfter.identity).toBe("same-element");
  expect(frameAfter.family).toContain(updatedFamily!);
  expect(frameAfter.width).not.toBe(frameBefore.width);

  const metrics = {
    sourcePath: BENCH_FONT_PATH,
    glyphCount,
    initial,
    updated,
    editToObservedInstallMs,
  };
  await testInfo.attach("compiled-proof-large-font-timings.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
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
