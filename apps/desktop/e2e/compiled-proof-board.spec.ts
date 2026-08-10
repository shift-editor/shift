import { createBridge } from "@shift/bridge";
import fs from "node:fs";
import os from "node:os";
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
  let compiledFont: number[];
  let compileMs: number;
  let compiledBytes: number;
  let compileRoot: string;

  test.beforeAll(async () => {
    compileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-proof-compile-"));
    const bridge = createBridge();
    const outputPath = path.join(compileRoot, "MutatorSans-proof.ttf");

    try {
      bridge.openWorkspace(VARIABLE_SOURCE_PATH, path.join(compileRoot, "workspace.sqlite"));
      const started = nodePerformance.now();
      await bridge.exportWorkspace({ path: outputPath, format: "ttf" });
      compileMs = nodePerformance.now() - started;
      const bytes = fs.readFileSync(outputPath);
      compiledBytes = bytes.byteLength;
      compiledFont = Array.from(bytes);
    } finally {
      bridge.closeWorkspace();
    }
  });

  test.afterAll(() => {
    fs.rmSync(compileRoot, { recursive: true, force: true });
  });

  test("shares scene data, camera motion, and a compiled variable FontFace", async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page, "41");

    const setup = await page.evaluate(async (fontBytes) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      const family = `ShiftCompiledProof-${Date.now()}`;
      const started = window.performance.now();
      const face = new FontFace(family, new Uint8Array(fontBytes).buffer);
      document.fonts.add(face);
      await face.load();
      const loadMs = window.performance.now() - started;
      document.documentElement.style.setProperty("--shift-working-font-family", `"${family}"`);

      const axes = workspace.font.getAxes();
      if (axes.length === 0) throw new Error("Expected variable authored fixture");

      const lowValues = Object.fromEntries(
        axes.map((axis) => [axis.id, axis.minimum ?? axis.default]),
      );
      const highValues = Object.fromEntries(
        axes.map((axis) => [axis.id, axis.maximum ?? axis.default]),
      );
      const run = workspace.editor.text.createRun("FISH");
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
        family,
        loadMs,
        runId: run.id,
        lowNodeId: low.id,
        highNodeId: high.id,
        axisTags: axes.map((axis) => axis.tag),
      };
    }, compiledFont);

    const proofLayer = page.locator("[data-compiled-proof-layer]");
    const frames = proofLayer.locator("[data-proof-node-id]");
    await expect(frames).toHaveCount(2);
    await expect(frames.nth(0)).toHaveAttribute("data-proof-run-id", setup.runId);
    await expect(frames.nth(1)).toHaveAttribute("data-proof-run-id", setup.runId);
    await expect(frames.nth(0)).toHaveText("FISH");
    await expect(frames.nth(1)).toHaveText("FISH");

    const styles = await frames.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          family: style.fontFamily,
          variations: style.fontVariationSettings,
          fontSize: style.fontSize,
        };
      }),
    );
    expect(styles.every((style) => style.family.includes(setup.family))).toBe(true);
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

    await testInfo.attach("compiled-proof-timings.json", {
      body: Buffer.from(
        JSON.stringify(
          {
            compileMs,
            fontFaceLoadMs: setup.loadMs,
            compiledBytes,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  });
});
