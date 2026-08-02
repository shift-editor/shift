import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { AxisId, SourceId } from "@shift/types";
import { test, expect, navigateToEditor } from "./fixtures/perfApp";

const RESIDENT_GPU_ERROR = /resident glyph (device lost|frame failed|initialization failed)/i;

test.describe("Resident catalog GPU", () => {
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

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });

    const initialSize = await glyphCanvas.evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    expect(initialSize.width).toBeGreaterThan(1);
    expect(initialSize.height).toBeGreaterThan(1);
    await trackSlugFrameSubmits(page);
    await trackSlugAtlasLoads(page);
    const viewportBox = await scrollViewport.boundingBox();
    expect(viewportBox).not.toBeNull();
    if (!viewportBox) throw new Error("Expected catalog viewport bounds");

    for (let index = 0; index < 12; index += 1) {
      await page.mouse.move(
        viewportBox.x + 20 + ((index * 71) % Math.max(1, viewportBox.width - 40)),
        viewportBox.y + 20 + ((index * 47) % Math.max(1, viewportBox.height - 40)),
      );
      await afterNextPaint(page);
    }

    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugFrameSubmits))
      .toBe("0");

    await scrollViewport.click({ position: { x: 50, y: 50 } });
    await page.waitForURL(/#\/editor\//);
    await afterNextPaint(page);
    await page.waitForTimeout(3_000);

    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas) => ({ width: canvas.width, height: canvas.height })),
      )
      .toEqual(initialSize);

    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    const returnStarted = performance.now();
    await afterNextPaint(page);

    await expect(glyphCanvas).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugFrameSubmits))
      .toBe("1");
    const returnDuration = performance.now() - returnStarted;
    console.log(`Resident catalog frame restored in ${returnDuration.toFixed(0)}ms`);
    expect(returnDuration).toBeLessThan(1_000);

    const catalogSurface = scrollViewport.locator("..");
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
    expect(
      await page.evaluate(() => document.documentElement.dataset.slugCompleteAtlasPrepares),
    ).toBe("0");
    expect(await page.evaluate(() => document.documentElement.dataset.slugPatchRootCounts)).toBe(
      "[]",
    );
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

    const scrollViewport = page.getByLabel("Glyph catalog");
    const catalogSurface = scrollViewport.locator("..");
    const glyphCanvas = catalogSurface.locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(760, 500);
    });
    await afterNextPaint(page);
    await expect
      .poll(() => scrollViewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await trackSlugAtlasLoads(page);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[aria-label="Glyph catalog"] + canvas',
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
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugCompleteAtlasPrepares))
      .toBe("0");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugPatchRootCounts))
      .toBe("[]");
    expect(errors).toEqual([]);
  });

  test("restores the current viewport after a topology edit", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });

    await navigateToEditor(page, "53");
    await trackSlugFrameSubmits(page);
    await trackSlugAtlasLoads(page);
    const editStarted = performance.now();

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

    const returnStarted = performance.now();
    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await expect
      .poll(
        () => page.evaluate(() => Number(document.documentElement.dataset.slugFrameSubmits ?? "0")),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(1);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    const recoveryDuration = performance.now() - returnStarted;
    const refreshDuration = performance.now() - editStarted;

    const atlasLoads = await page.evaluate(() => ({
      complete: Number(document.documentElement.dataset.slugCompleteAtlasPrepares),
      patches: JSON.parse(document.documentElement.dataset.slugPatchRootCounts ?? "[]") as number[],
      glyphCount: window.shift?.font.glyphRecords().length ?? 0,
    }));
    console.log(
      `Resident catalog topology recovery took ${recoveryDuration.toFixed(0)}ms (${refreshDuration.toFixed(0)}ms from edit)`,
    );
    expect(recoveryDuration).toBeLessThan(1_000);
    expect(atlasLoads.complete).toBe(0);
    expect(atlasLoads.patches).toHaveLength(1);
    expect(atlasLoads.patches[0]).toBeGreaterThan(0);
    expect(atlasLoads.patches[0]).toBeLessThan(atlasLoads.glyphCount);
  });

  test("keeps distant glyphs resident after a topology patch", async ({ electronApp, page }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
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
    await trackSlugFrameSubmits(page);

    const scrollStarted = performance.now();
    await scrollViewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(
        () => page.evaluate(() => Number(document.documentElement.dataset.slugFrameSubmits ?? "0")),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(1);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    const scrollDuration = performance.now() - scrollStarted;

    console.log(`Resident catalog distant viewport recovery took ${scrollDuration.toFixed(0)}ms`);
    expect(scrollDuration).toBeLessThan(1_000);
  });

  test("replaces the visible frame before completing a selected-source deletion", async ({
    electronApp,
    page,
  }) => {
    const glyphCanvas = await preparePagedGrid(electronApp, page);
    const variable = await createVariableDesignspace(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await trackGridTransitions(page);
    await trackSlugAtlasLoads(page);

    await page.evaluate(async ({ axisId, sourceId }) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      workspace.editor.setDesignLocation(new Map([[axisId, 900]]));
      workspace.font.deleteSource(sourceId);
      await workspace.font.editCoordinator.settled();
    }, variable);

    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    const state = await observedGridState(page);
    expect(state.readiness).toEqual(expect.arrayContaining(["Stale", "Visible", "Complete"]));
    expect(state.readiness.indexOf("Stale")).toBeLessThan(state.readiness.indexOf("Visible"));
    expect(state.readiness.indexOf("Visible")).toBeLessThan(
      state.readiness.lastIndexOf("Complete"),
    );
    expect(state.hiddenTransitions).toBe(0);
    expect(state.patchRootCounts[0]).toBeLessThan(state.glyphCount);
    expect(state.patchRootCounts.at(-1)).toBe(state.glyphCount);
  });

  test("replaces a non-default design location atomically after deleting its axis", async ({
    electronApp,
    page,
  }) => {
    const glyphCanvas = await preparePagedGrid(electronApp, page);
    const variable = await createVariableDesignspace(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await trackGridTransitions(page);

    const deletedAxis = await page.evaluate(async ({ axisId }) => {
      const workspace = window.shift;
      if (!workspace) throw new Error("Expected workspace");

      workspace.editor.setDesignLocation(new Map([[axisId, 750]]));
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
    expect(state.readiness).toEqual(expect.arrayContaining(["Stale", "Visible", "Complete"]));
    expect(state.readiness.indexOf("Stale")).toBeLessThan(state.readiness.indexOf("Visible"));
    expect(state.readiness.indexOf("Visible")).toBeLessThan(
      state.readiness.lastIndexOf("Complete"),
    );
    expect(state.hiddenTransitions).toBe(0);
  });

  test("expands every preview cell for outlines outside the font metrics", async ({ page }) => {
    const scrollViewport = page.getByLabel("Glyph catalog");
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    const initialHeight = Number(await glyphCanvas.getAttribute("data-preview-height"));

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

    await expect
      .poll(async () => Number(await glyphCanvas.getAttribute("data-preview-height")))
      .toBeGreaterThan(initialHeight);
    await expect(glyphCanvas).toBeVisible();
    expect(Number(await glyphCanvas.getAttribute("data-preview-horizontal"))).toBeGreaterThan(0);
  });
});

async function createVariableDesignspace(
  page: Page,
): Promise<{ axisId: AxisId; sourceId: SourceId }> {
  return page.evaluate(async () => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected font");

    const axisId = font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await font.editCoordinator.settled();
    const sourceId = font.createSource("Bold", { values: { [axisId]: 900 } });
    await font.editCoordinator.settled();
    return { axisId, sourceId };
  });
}

async function preparePagedGrid(electronApp: ElectronApplication, page: Page): Promise<Locator> {
  await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
  await electronApp.evaluate(async ({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(760, 500);
  });

  const scrollViewport = page.getByLabel("Glyph catalog");
  const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
  await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });
  return glyphCanvas;
}

async function trackGridTransitions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[aria-label="Glyph catalog"] + canvas',
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
  patchRootCounts: number[];
  glyphCount: number;
}> {
  return page.evaluate(() => ({
    readiness: JSON.parse(
      document.documentElement.dataset.gridReadinessTransitions ?? "[]",
    ) as string[],
    hiddenTransitions: Number(document.documentElement.dataset.gridHiddenTransitions),
    patchRootCounts: JSON.parse(
      document.documentElement.dataset.slugPatchRootCounts ?? "[]",
    ) as number[],
    glyphCount: window.shift?.font.glyphRecords().length ?? 0,
  }));
}

async function trackSlugFrameSubmits(page: Page): Promise<void> {
  await page.evaluate(() => {
    const originalSubmit = GPUQueue.prototype.submit;
    document.documentElement.dataset.slugFrameSubmits = "0";
    GPUQueue.prototype.submit = function submit(commandBuffers) {
      const buffers = [...commandBuffers];
      for (const commandBuffer of buffers) {
        if (commandBuffer.label !== "shift Slug frame") continue;

        document.documentElement.dataset.slugFrameSubmits = String(
          Number(document.documentElement.dataset.slugFrameSubmits) + 1,
        );
      }
      originalSubmit.call(this, buffers);
    };
  });
}

async function trackSlugAtlasLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const coordinator = window.shift?.font.editCoordinator;
    if (!coordinator) throw new Error("Expected workspace edit coordinator");

    const originalCompletePrepare = coordinator.prepareSlugAtlas.bind(coordinator);
    const originalPatchPrepare = coordinator.prepareSlugAtlasPage.bind(coordinator);
    document.documentElement.dataset.slugCompleteAtlasPrepares = "0";
    document.documentElement.dataset.slugPatchRootCounts = "[]";
    coordinator.prepareSlugAtlas = async (alignment) => {
      document.documentElement.dataset.slugCompleteAtlasPrepares = String(
        Number(document.documentElement.dataset.slugCompleteAtlasPrepares) + 1,
      );
      return originalCompletePrepare(alignment);
    };
    coordinator.prepareSlugAtlasPage = async (glyphIds, alignment) => {
      const counts = JSON.parse(
        document.documentElement.dataset.slugPatchRootCounts ?? "[]",
      ) as number[];
      counts.push(glyphIds.length);
      document.documentElement.dataset.slugPatchRootCounts = JSON.stringify(counts);
      return originalPatchPrepare(glyphIds, alignment);
    };
  });
}

async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
