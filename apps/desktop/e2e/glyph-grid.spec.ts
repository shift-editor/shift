import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { rect, square, triangle } from "@/testing/fixtures";
import type { FontFixture } from "@/testing/fonts";
import { test, expect } from "./fixtures/perfApp";
import {
  afterNextPaint,
  countGlyphCanvasHides,
  expectCompleteResidency,
  fontsReady,
  gpuAvailable,
  hiddenGlyphCanvasCount,
  observedGridState,
  paintsGlyphs,
  scrubGridGeometry,
  trackGridTransitions,
  viewportHeight,
  waitForSettledGrid,
} from "./fixtures/glyphCatalogProbe";
import {
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphCatalogViewport,
  openCatalogGlyph,
} from "./fixtures/appLocators";

const RESIDENT_GPU_ERROR = /resident glyph (device lost|frame failed|initialization failed)/i;

/**
 * An `opsz` axis and a Bold source at 900 whose every metric is twice MutatorSans's (Ascender
 * 700, Cap Height 700, x-Height 500, Baseline 0, Descender -200), so scrubbing toward it grows
 * every Grid cell; the editor stays at the default location.
 */
const TALL_BOLD = {
  axes: [{ tag: "opsz", name: "Optical Size", minimum: 100, default: 400, maximum: 900 }],
  sources: { Bold: { opsz: 900 } },
  metrics: {
    Bold: { Ascender: 1400, "Cap Height": 1400, "x-Height": 1000, Baseline: 0, Descender: -400 },
  },
  location: { opsz: 400 },
} as const satisfies FontFixture;

test.describe("Resident Glyph Grid", () => {
  test("redraws the resident viewport without rebuilding it after editor navigation", async ({
    editor,
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && RESIDENT_GPU_ERROR.test(message.text())) {
        errors.push(message.text());
      }
    });

    await expect.poll(() => gpuAvailable(page)).toBe(true);

    const scrollViewport: Locator = glyphCatalogViewport(page);
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas: Locator = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await fontsReady(page);
    await afterNextPaint(page);

    const viewportBox = await scrollViewport.boundingBox();
    expect(viewportBox).not.toBeNull();
    if (!viewportBox) throw new Error("Expected catalog viewport bounds");

    await page.mouse.move(viewportBox.x + 20, viewportBox.y + 20);
    await afterNextPaint(page);
    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas: HTMLCanvasElement) => {
          const bounds = canvas.getBoundingClientRect();
          const scale = window.devicePixelRatio;
          return (
            canvas.width === Math.floor(bounds.width * scale) &&
            canvas.height === Math.floor(bounds.height * scale)
          );
        }),
      )
      .toBe(true);

    const initialSize = await glyphCanvas.evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    expect(initialSize.width).toBeGreaterThan(1);
    expect(initialSize.height).toBeGreaterThan(1);
    const initialBuilds = await atlasBuildCount(glyphCanvas);
    expect(initialBuilds).toBeGreaterThan(0);

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
        glyphCanvas.evaluate((canvas: HTMLCanvasElement) => ({
          width: canvas.width,
          height: canvas.height,
        })),
      )
      .toEqual(initialSize);

    const [firstName] = await editor.glyphNames();
    const firstGlyph = firstName ? await editor.glyphNamed(firstName) : null;
    if (!firstGlyph) throw new Error("Expected first catalog glyph");
    await openCatalogGlyph(page, firstGlyph.name, firstGlyph.id);
    await expect(page.locator("#scene-canvas")).toBeVisible();
    await afterNextPaint(page);

    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas: HTMLCanvasElement) => ({
          width: canvas.width,
          height: canvas.height,
        })),
      )
      .toEqual(initialSize);

    await page.getByRole("button", { name: "Font overview" }).click();
    await page.waitForURL(/#\/home/);
    await afterNextPaint(page);

    await expect(glyphCanvas).toBeVisible();
    await expectCompleteResidency(glyphCanvas);

    const catalogSurface = glyphCatalogSurface(page);
    expect(await paintsGlyphs(catalogSurface, glyphCanvas)).toBe(true);
    await expect
      .poll(() =>
        glyphCanvas.evaluate((canvas: HTMLCanvasElement) => ({
          width: canvas.width,
          height: canvas.height,
        })),
      )
      .toEqual(initialSize);
    await expectCompleteResidency(glyphCanvas);
    expect(await atlasBuildCount(glyphCanvas)).toBe(initialBuilds);
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

    await expect.poll(() => gpuAvailable(page)).toBe(true);

    const scrollViewport: Locator = glyphCatalogViewport(page);
    const catalogSurface = glyphCatalogSurface(page);
    const glyphCanvas: Locator = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");

    await resizeWorkspaceWindow(electronApp, page);
    await afterNextPaint(page);
    await expect
      .poll(() => scrollViewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await countGlyphCanvasHides(page);

    for (const fraction of [0, 0.5, 1, 0.5, 0]) {
      await scrollViewport.evaluate((element, nextFraction) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * nextFraction;
      }, fraction);
      await afterNextPaint(page);
      await expectCompleteResidency(glyphCanvas);

      expect(await paintsGlyphs(catalogSurface, glyphCanvas)).toBe(true);
    }

    await expect(glyphCanvas).toBeVisible();
    await expect.poll(() => hiddenGlyphCanvasCount(page)).toBe(0);
    await expectCompleteResidency(glyphCanvas);
    expect(errors).toEqual([]);
  });

  test("replaces topology-edited glyphs atomically when returning Home", async ({
    page,
    editor,
  }) => {
    await expect.poll(() => gpuAvailable(page)).toBe(true);

    const scrollViewport: Locator = glyphCatalogViewport(page);
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas: Locator = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });

    await editor.openGlyphByUnicode("53");
    await trackGridTransitions(page);

    await editor.draw({ contours: [square(100)] });

    await page.getByRole("button", { name: "Font overview" }).click();
    await page.waitForURL(/#\/home/);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expectCompleteResidency(glyphCanvas);

    const state = await observedGridState(page);
    expectAtomicGridReadiness(state.readiness);
    expect(state.hiddenTransitions).toBe(0);
  });

  test("keeps distant glyphs resident after a topology patch", async ({
    electronApp,
    page,
    editor,
  }) => {
    await expect.poll(() => gpuAvailable(page)).toBe(true);

    const scrollViewport: Locator = glyphCatalogViewport(page);
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas: Locator = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await resizeWorkspaceWindow(electronApp, page);
    await afterNextPaint(page);
    await expect
      .poll(() => scrollViewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);

    await editor.openGlyphByUnicode("53");
    await editor.draw({ contours: [triangle([0, 0], [80, 0], [40, 80])] });

    await page.getByRole("button", { name: "Font overview" }).click();
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
    expect(await paintsGlyphs(catalogSurface, glyphCanvas)).toBe(true);
  });

  test.describe("with a Bold source twice as tall", () => {
    test.use({ font: TALL_BOLD });

    test("replaces a selected-source deletion atomically", async ({
      editor,
      electronApp,
      page,
    }) => {
      const glyphCanvas = await prepareCompleteGrid(electronApp, page);
      // Arm the observer only after the setup edits have reached a settled frame, so every
      // recorded transition belongs to the mutation under test.
      await waitForSettledGrid(page, glyphCanvas);
      await trackGridTransitions(page);

      await editor.setLocation({ opsz: 900 });
      await editor.deleteSource("Bold");

      await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
        timeout: 30_000,
      });
      const state = await observedGridState(page);
      expectAtomicGridReadiness(state.readiness);
      expect(state.hiddenTransitions).toBe(0);
    });

    test("replaces a non-default design location atomically after deleting its axis", async ({
      editor,
      electronApp,
      page,
    }) => {
      const glyphCanvas = await prepareCompleteGrid(electronApp, page);
      // Arm the observer only after the setup edits have reached a settled frame, so every
      // recorded transition belongs to the mutation under test.
      await waitForSettledGrid(page, glyphCanvas);
      await trackGridTransitions(page);

      await editor.setLocation({ opsz: 750 });
      await afterNextPaint(page);
      await editor.deleteAxis("opsz");

      await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
        timeout: 30_000,
      });
      expect(await editor.axis({ tag: "opsz" })).toBeNull();
      const state = await observedGridState(page);
      expectAtomicGridReadiness(state.readiness);
      expect(state.hiddenTransitions).toBe(0);
    });
  });

  test.describe("with an S outline larger than the em and a Bold source twice as tall", () => {
    test.use({
      font: {
        ...TALL_BOLD,
        glyphs: { S: { outline: { contours: [rect(-600, -800, 2400, 2600)] } } },
      },
    });

    test("keeps cell geometry stable while scrubbing an axis with oversized outlines", async ({
      page,
      editor,
    }) => {
      const scrollViewport: Locator = glyphCatalogViewport(page);
      const catalogSurface = glyphCatalogSurface(page);
      const glyphCanvas: Locator = glyphCatalogCanvas(page);
      // Drawing S opened the editor; the Grid is on Home.
      await page.getByRole("button", { name: "Font overview" }).click();
      await page.waitForURL(/#\/home/);
      await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
        timeout: 30_000,
      });

      await waitForSettledGrid(page, glyphCanvas);
      const initialGeometry = {
        previewHeight: Number(await glyphCanvas.getAttribute("data-preview-height")),
        scrollHeight: await scrollViewport.evaluate((element) => element.scrollHeight),
      };
      const geometrySamples = await scrubGridGeometry(
        editor,
        glyphCanvas,
        "opsz",
        [500, 650, 800, 900, 650, 400],
      );

      expect(geometrySamples).toEqual(
        Array.from({ length: geometrySamples.length }, () => initialGeometry),
      );
      await expect(glyphCanvas).toBeVisible();
      expect(await paintsGlyphs(catalogSurface, glyphCanvas)).toBe(true);
    });
  });
});

async function prepareCompleteGrid(electronApp: ElectronApplication, page: Page): Promise<Locator> {
  await expect.poll(() => gpuAvailable(page)).toBe(true);
  await resizeWorkspaceWindow(electronApp, page);

  const glyphCanvas: Locator = glyphCatalogCanvas(page);
  await waitForSettledGrid(page, glyphCanvas);
  return glyphCanvas;
}

/**
 * Shortens the window that owns `page` so the catalog scrolls, and waits for the new viewport.
 *
 * @remarks
 * Workspace windows enforce a minimum width, so only the height can shrink.
 */
async function resizeWorkspaceWindow(electronApp: ElectronApplication, page: Page): Promise<void> {
  const browserWindow = await electronApp.browserWindow(page);
  await browserWindow.evaluate((window) =>
    window.setContentSize(window.getContentSize()[0] ?? 0, 450),
  );
  await browserWindow.dispose();
  await expect.poll(() => viewportHeight(page)).toBe(450);
}

async function atlasBuildCount(glyphCanvas: Locator): Promise<number> {
  return Number(await glyphCanvas.getAttribute("data-atlas-build-count"));
}

function expectAtomicGridReadiness(readiness: readonly string[]): void {
  const staleIndex = readiness.indexOf("Stale");
  const completeIndex = readiness.lastIndexOf("Complete");

  expect(staleIndex).toBeGreaterThanOrEqual(0);
  expect(completeIndex).toBeGreaterThan(staleIndex);
  expect(readiness).not.toContain("Visible");
}
