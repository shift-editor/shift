import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { AxisId, SourceId } from "@shift/types";
import { test, expect, navigateToEditor } from "./fixtures/perfApp";
import {
  clickFirstCatalogGlyph,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphCatalogViewport,
} from "./fixtures/appLocators";

const RESIDENT_GPU_ERROR = /resident glyph (device lost|frame failed|initialization failed)/i;

test.describe("Resident Glyph Grid", () => {
  test("redraws the resident viewport without rebuilding it after editor navigation", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && RESIDENT_GPU_ERROR.test(message.text())) {
        errors.push(message.text());
      }
    });

    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = glyphCatalogViewport(page);
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await page.evaluate(() => document.fonts.ready);
    await afterNextPaint(page);

    const viewportBox = await scrollViewport.boundingBox();
    expect(viewportBox).not.toBeNull();
    if (!viewportBox) throw new Error("Expected catalog viewport bounds");

    await page.mouse.move(viewportBox.x + 20, viewportBox.y + 20);
    await afterNextPaint(page);
    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas) => {
          const bounds = canvas.getBoundingClientRect();
          const scale = window.devicePixelRatio;
          return (
            canvas.width === Math.floor(bounds.width * scale) &&
            canvas.height === Math.floor(bounds.height * scale)
          );
        }),
      )
      .toBe(true);

    const initialSize = await glyphCanvas.evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    expect(initialSize.width).toBeGreaterThan(1);
    expect(initialSize.height).toBeGreaterThan(1);

    for (let index = 0; index < 12; index += 1) {
      await page.mouse.move(
        viewportBox.x + 20 + ((index * 71) % Math.max(1, viewportBox.width - 40)),
        viewportBox.y + 20 + ((index * 47) % Math.max(1, viewportBox.height - 40)),
      );
      await afterNextPaint(page);
    }

    await expectCompleteResidency(glyphCanvas);
    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
      )
      .toEqual(initialSize);

    await clickFirstCatalogGlyph(page);
    await page.waitForURL(/#\/editor\//);
    await expect(page.locator("#scene-canvas")).toBeVisible();
    await afterNextPaint(page);

    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
      )
      .toEqual(initialSize);

    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await afterNextPaint(page);

    await expect(glyphCanvas).toBeVisible();
    await expectCompleteResidency(glyphCanvas);

    const catalogSurface = glyphCatalogSurface(page);
    const returnedFrame = await catalogSurface.screenshot();
    const previousVisibility = await glyphCanvas.evaluate((canvas) => {
      const visibility = canvas.style.visibility;
      canvas.style.visibility = "hidden";
      return visibility;
    });
    const frameWithoutGlyphs = await catalogSurface.screenshot();
    await glyphCanvas.evaluate((canvas, visibility) => {
      canvas.style.visibility = visibility;
    }, previousVisibility);
    expect(returnedFrame.equals(frameWithoutGlyphs)).toBe(false);
    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
      )
      .toEqual(initialSize);
    await expectCompleteResidency(glyphCanvas);
    expect(errors).toEqual([]);
  });

  test("keeps the complete atlas painted while scrolling downward and upward", async ({
    electronApp,
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && RESIDENT_GPU_ERROR.test(message.text())) {
        errors.push(message.text());
      }
    });

    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = glyphCatalogViewport(page);
    const catalogSurface = glyphCatalogSurface(page);
    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(760, 500);
    });
    await afterNextPaint(page);
    await expect
      .poll(() => scrollViewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="glyph-catalog-canvas"]',
      );
      if (!canvas) throw new Error("Expected resident glyph canvas");

      document.documentElement.dataset.slugHiddenTransitions = "0";
      document.documentElement.dataset.slugIgnoreHiddenTransitions = "false";
      new MutationObserver(() => {
        if (
          canvas.style.visibility !== "hidden" ||
          document.documentElement.dataset.slugIgnoreHiddenTransitions === "true"
        ) {
          return;
        }

        document.documentElement.dataset.slugHiddenTransitions = String(
          Number(document.documentElement.dataset.slugHiddenTransitions) + 1,
        );
      }).observe(canvas, { attributeFilter: ["style"], attributes: true });
    });

    for (const fraction of [0, 0.5, 1, 0.5, 0]) {
      await scrollViewport.evaluate((element, nextFraction) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * nextFraction;
      }, fraction);
      await afterNextPaint(page);
      await expectCompleteResidency(glyphCanvas);

      const paintedFrame = await catalogSurface.screenshot();
      const visibility = await glyphCanvas.evaluate((canvas) => {
        document.documentElement.dataset.slugIgnoreHiddenTransitions = "true";
        const previous = canvas.style.visibility;
        canvas.style.visibility = "hidden";
        return previous;
      });
      const frameWithoutGlyphs = await catalogSurface.screenshot();
      await glyphCanvas.evaluate((canvas, previous) => {
        canvas.style.visibility = previous;
        document.documentElement.dataset.slugIgnoreHiddenTransitions = "false";
      }, visibility);
      expect(paintedFrame.equals(frameWithoutGlyphs)).toBe(false);
    }

    await expect(glyphCanvas).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugHiddenTransitions))
      .toBe("0");
    await expectCompleteResidency(glyphCanvas);
    expect(errors).toEqual([]);
  });

  test("restores the current viewport after a topology edit", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = glyphCatalogViewport(page);
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });

    await navigateToEditor(page, "53");
    await trackGridTransitions(page);

    await page.evaluate(async () => {
      const editor = window.shift?.editor;
      if (!editor) throw new Error("Expected editor runtime");

      const inserted = editor.insertContent({
        contours: [
          {
            closed: true,
            points: [
              { x: 0, y: 0, pointType: "onCurve", smooth: false },
              { x: 100, y: 0, pointType: "onCurve", smooth: false },
              { x: 100, y: 100, pointType: "onCurve", smooth: false },
              { x: 0, y: 100, pointType: "onCurve", smooth: false },
            ],
          },
        ],
      });
      if (!inserted) throw new Error("Topology insertion failed");

      await editor.font.editCoordinator.settled();
    });

    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expectCompleteResidency(glyphCanvas);

    const state = await observedGridState(page);
    expectAtomicGridReadiness(state.readiness);
    expect(state.hiddenTransitions).toBe(0);
  });

  test("keeps distant glyphs resident after a topology patch", async ({ electronApp, page }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = glyphCatalogViewport(page);
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(760, 500);
    });
    await afterNextPaint(page);
    await expect
      .poll(() => scrollViewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);

    await navigateToEditor(page, "53");
    await page.evaluate(async () => {
      const editor = window.shift?.editor;
      if (!editor) throw new Error("Expected editor runtime");

      const inserted = editor.insertContent({
        contours: [
          {
            closed: true,
            points: [
              { x: 0, y: 0, pointType: "onCurve", smooth: false },
              { x: 80, y: 0, pointType: "onCurve", smooth: false },
              { x: 40, y: 80, pointType: "onCurve", smooth: false },
            ],
          },
        ],
      });
      if (!inserted) throw new Error("Topology insertion failed");
      await editor.font.editCoordinator.settled();
    });

    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expectCompleteResidency(glyphCanvas);
    await trackGridTransitions(page);

    await scrollViewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await afterNextPaint(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expectCompleteResidency(glyphCanvas);

    const state = await observedGridState(page);
    expect(state.readiness).toEqual([]);
    expect(state.hiddenTransitions).toBe(0);

    const catalogSurface = glyphCatalogSurface(page);
    const paintedFrame = await catalogSurface.screenshot();
    const visibility = await glyphCanvas.evaluate((canvas) => {
      const previous = canvas.style.visibility;
      canvas.style.visibility = "hidden";
      return previous;
    });
    const frameWithoutGlyphs = await catalogSurface.screenshot();
    await glyphCanvas.evaluate((canvas, previous) => {
      canvas.style.visibility = previous;
    }, visibility);
    expect(paintedFrame.equals(frameWithoutGlyphs)).toBe(false);
  });

  test("replaces a selected-source deletion atomically", async ({ electronApp, page }) => {
    const glyphCanvas = await prepareCompleteGrid(electronApp, page);
    const variable = await createVariableDesignspace(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await trackGridTransitions(page);

    await page.evaluate(async ({ axisId, sourceId }) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      workspace.editor.setExternalLocation(new Map([[axisId, 900]]));
      workspace.font.deleteSource(sourceId);
      await workspace.font.editCoordinator.settled();
    }, variable);

    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    const state = await observedGridState(page);
    expectAtomicGridReadiness(state.readiness);
    expect(state.hiddenTransitions).toBe(0);
  });

  test("replaces a non-default design location atomically after deleting its axis", async ({
    electronApp,
    page,
  }) => {
    const glyphCanvas = await prepareCompleteGrid(electronApp, page);
    const variable = await createVariableDesignspace(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await trackGridTransitions(page);

    const deletedAxis = await page.evaluate(async ({ axisId }) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      workspace.editor.setExternalLocation(new Map([[axisId, 750]]));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      workspace.font.deleteAxis(axisId);
      await workspace.font.editCoordinator.settled();
      return axisId;
    }, variable);

    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    expect(
      await page.evaluate(
        (axisId) => window.shift?.font.getAxes().some((axis) => axis.id === axisId),
        deletedAxis,
      ),
    ).toBe(false);
    const state = await observedGridState(page);
    expectAtomicGridReadiness(state.readiness);
    expect(state.hiddenTransitions).toBe(0);
  });

  test("fits oversized outlines without resizing cells while scrubbing an axis", async ({
    page,
  }) => {
    const scrollViewport = glyphCatalogViewport(page);
    const catalogSurface = glyphCatalogSurface(page);
    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });

    await navigateToEditor(page, "53");
    await page.evaluate(async () => {
      const editor = window.shift?.editor;
      if (!editor) throw new Error("Expected editor runtime");
      const inserted = editor.insertContent({
        contours: [
          {
            closed: true,
            points: [
              { x: -600, y: -800, pointType: "onCurve", smooth: false },
              { x: 1800, y: -800, pointType: "onCurve", smooth: false },
              { x: 1800, y: 1800, pointType: "onCurve", smooth: false },
              { x: -600, y: 1800, pointType: "onCurve", smooth: false },
            ],
          },
        ],
      });
      if (!inserted) throw new Error("Oversized contour insertion failed");
      await editor.font.editCoordinator.settled();
    });
    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });

    const variable = await createVariableDesignspace(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    const initialGeometry = {
      previewHeight: Number(await glyphCanvas.getAttribute("data-preview-height")),
      scrollHeight: await scrollViewport.evaluate((element) => element.scrollHeight),
    };
    const geometrySamples = await page.evaluate(async ({ axisId }) => {
      const workspace = window.shift;
      const viewport = document.querySelector<HTMLElement>('[aria-label="Glyph catalog"]');
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="glyph-catalog-canvas"]',
      );
      if (!workspace || !viewport || !canvas) throw new Error("Expected Grid runtime");

      const samples: Array<{ previewHeight: number; scrollHeight: number }> = [];
      for (const value of [400, 500, 650, 800, 900, 650, 400]) {
        workspace.editor.setExternalLocation(new Map([[axisId, value]]));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push({
          previewHeight: Number(canvas.dataset.previewHeight),
          scrollHeight: viewport.scrollHeight,
        });
      }
      return samples;
    }, variable);

    expect(geometrySamples).toEqual(
      Array.from({ length: geometrySamples.length }, () => initialGeometry),
    );
    await expect(glyphCanvas).toBeVisible();
    const renderedFrame = await catalogSurface.screenshot();
    const visibility = await glyphCanvas.evaluate((canvas) => {
      const previous = canvas.style.visibility;
      canvas.style.visibility = "hidden";
      return previous;
    });
    const frameWithoutGlyphs = await catalogSurface.screenshot();
    await glyphCanvas.evaluate((canvas, previous) => {
      canvas.style.visibility = previous;
    }, visibility);
    expect(renderedFrame.equals(frameWithoutGlyphs)).toBe(false);
  });
});

async function createVariableDesignspace(
  page: Page,
): Promise<{ axisId: AxisId; sourceId: SourceId }> {
  return page.evaluate(async () => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected font");

    const axisId = font.createAxis({
      tag: "opsz",
      name: "Optical Size",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await font.editCoordinator.settled();
    const sourceId = font.createSource("Bold", new Map([[axisId, 900]]));
    await font.editCoordinator.settled();
    const source = font.sources.find((candidate) => candidate.id === sourceId);
    if (!source || source.metricValues.length === 0) {
      throw new Error("Expected Bold source metrics");
    }
    await font.updateSource({
      ...source,
      metricValues: source.metricValues.map((value) => ({
        ...value,
        position: value.position * 2,
      })),
    });
    await font.editCoordinator.settled();
    return { axisId, sourceId };
  });
}

async function prepareCompleteGrid(electronApp: ElectronApplication, page: Page): Promise<Locator> {
  await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
  await electronApp.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(760, 500);
  });

  const scrollViewport = glyphCatalogViewport(page);
  const glyphCanvas = glyphCatalogCanvas(page);
  await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });
  return glyphCanvas;
}

async function trackGridTransitions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="glyph-catalog-canvas"]',
    );
    if (!canvas) throw new Error("Expected resident glyph canvas");

    document.documentElement.dataset.gridReadinessTransitions = "[]";
    document.documentElement.dataset.gridHiddenTransitions = "0";
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === "data-grid-readiness") {
          const transitions = JSON.parse(
            document.documentElement.dataset.gridReadinessTransitions ?? "[]",
          ) as string[];
          transitions.push(canvas.dataset.gridReadiness ?? "");
          document.documentElement.dataset.gridReadinessTransitions = JSON.stringify(transitions);
        }
        if (record.attributeName === "style" && canvas.style.visibility === "hidden") {
          document.documentElement.dataset.gridHiddenTransitions = String(
            Number(document.documentElement.dataset.gridHiddenTransitions) + 1,
          );
        }
      }
    }).observe(canvas, {
      attributeFilter: ["data-grid-readiness", "style"],
      attributes: true,
    });
  });
}

async function observedGridState(page: Page): Promise<{
  readiness: string[];
  hiddenTransitions: number;
}> {
  return page.evaluate(() => ({
    readiness: JSON.parse(
      document.documentElement.dataset.gridReadinessTransitions ?? "[]",
    ) as string[],
    hiddenTransitions: Number(document.documentElement.dataset.gridHiddenTransitions),
  }));
}

function expectAtomicGridReadiness(readiness: readonly string[]): void {
  const staleIndex = readiness.indexOf("Stale");
  const completeIndex = readiness.lastIndexOf("Complete");

  expect(staleIndex).toBeGreaterThanOrEqual(0);
  expect(completeIndex).toBeGreaterThan(staleIndex);
  expect(readiness).not.toContain("Visible");
}

async function expectCompleteResidency(glyphCanvas: Locator): Promise<void> {
  await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });
  await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");
  const residency = await glyphCanvas.evaluate((canvas) => ({
    resident: Number(canvas.dataset.residentGlyphCount),
    target: Number(canvas.dataset.targetGlyphCount),
  }));
  expect(residency.target).toBeGreaterThan(0);
  expect(residency.resident).toBe(residency.target);
}

async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
