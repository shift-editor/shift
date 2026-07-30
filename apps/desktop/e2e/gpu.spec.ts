import type { Page } from "@playwright/test";
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
    expect(errors).toEqual([]);
  });

  test("prioritizes the final viewport while scrubbing the catalog", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && RESIDENT_GPU_ERROR.test(message.text())) {
        errors.push(message.text());
      }
    });

    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
    await page.waitForFunction(() => (window.shift?.font.glyphRecords().length ?? 0) > 0);
    await trackSlugPageLoads(page);

    const scrollViewport = page.getByLabel("Glyph catalog");
    await expect(scrollViewport).toBeVisible();
    const scrollable = await scrollViewport.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    );
    test.skip(!scrollable, "Catalog needs more than one viewport");

    const scrubStarted = performance.now();
    await scrollViewport.evaluate(async (element) => {
      const maximum = element.scrollHeight - element.clientHeight;
      for (let step = 1; step <= 12; step += 1) {
        element.scrollTop = (maximum * step) / 12;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      for (let step = 11; step >= 0; step -= 1) {
        element.scrollTop = (maximum * step) / 12;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    });

    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    const scrubDuration = performance.now() - scrubStarted;
    const pageLoads = await page.evaluate(
      () => JSON.parse(document.documentElement.dataset.slugPageRootCounts ?? "[]") as number[],
    );
    console.log(
      `Resident catalog scrub recovered in ${scrubDuration.toFixed(0)}ms after ${pageLoads.length} page loads`,
    );
    expect(scrubDuration).toBeLessThan(1_000);

    const finalFrame = await scrollViewport.locator("..").screenshot();
    const visibility = await glyphCanvas.evaluate((canvas) => {
      const previous = canvas.style.visibility;
      canvas.style.visibility = "hidden";
      return previous;
    });
    const frameWithoutGlyphs = await scrollViewport.locator("..").screenshot();
    await glyphCanvas.evaluate((canvas, previous) => {
      canvas.style.visibility = previous;
    }, visibility);
    expect(finalFrame.equals(frameWithoutGlyphs)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("keeps the fully resident catalog painted while thumb scrubbing", async ({
    electronApp,
    page,
  }) => {
    test.setTimeout(180_000);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
    await page.waitForFunction(() => Boolean(window.shift?.font.editCoordinator));
    const glyphCount = await page.evaluate(() => window.shift?.font.glyphRecords().length ?? 0);
    test.skip(glyphCount < 300, "Catalog needs a background atlas page");

    await page.evaluate(() => {
      const coordinator = window.shift?.font.editCoordinator;
      if (!coordinator) throw new Error("Expected workspace edit coordinator");

      const originalPrepare = coordinator.prepareSlugAtlasPage.bind(coordinator);
      const originalStream = coordinator.streamSlugAtlasPage.bind(coordinator);
      let blocked = false;
      document.documentElement.dataset.slugPageRootCounts = "[]";
      document.documentElement.dataset.slugPageStreams = "0";
      document.documentElement.dataset.slugBackgroundBlocked = "false";
      coordinator.prepareSlugAtlasPage = async (glyphIds, alignment) => {
        const counts = JSON.parse(
          document.documentElement.dataset.slugPageRootCounts ?? "[]",
        ) as number[];
        counts.push(glyphIds.length);
        document.documentElement.dataset.slugPageRootCounts = JSON.stringify(counts);
        const descriptor = await originalPrepare(glyphIds, alignment);
        if (!blocked && glyphIds.length >= 300) {
          blocked = true;
          document.documentElement.dataset.slugBackgroundBlocked = "true";
          await new Promise<void>((resolve) => {
            window.addEventListener("shift:e2e-release-slug-background", () => resolve(), {
              once: true,
            });
          });
        }
        return descriptor;
      };
      coordinator.streamSlugAtlasPage = async (generation, maximumLength, write) => {
        document.documentElement.dataset.slugPageStreams = String(
          Number(document.documentElement.dataset.slugPageStreams) + 1,
        );
        return originalStream(generation, maximumLength, write);
      };
    });

    const scrollViewport = page.getByLabel("Glyph catalog");
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugBackgroundBlocked))
      .toBe("true");

    const catalogSurface = scrollViewport.locator("..");
    const initialViewport = await catalogSurface.screenshot();
    const initialVisibility = await glyphCanvas.evaluate((canvas) => {
      const previous = canvas.style.visibility;
      canvas.style.visibility = "hidden";
      return previous;
    });
    const initialViewportWithoutGlyphs = await catalogSurface.screenshot();
    await glyphCanvas.evaluate((canvas, previous) => {
      canvas.style.visibility = previous;
    }, initialVisibility);
    expect(initialViewport.equals(initialViewportWithoutGlyphs)).toBe(false);

    await scrollViewport.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight;
    });
    await expect(glyphCanvas).toBeHidden();
    await page.evaluate(async () => {
      const font = window.shift?.font;
      const source = font?.sources[0];
      if (!font || !source) throw new Error("Expected a source for version invalidation");
      await font.updateSource({ ...source, name: `${source.name} E2E` });
      window.dispatchEvent(new Event("shift:e2e-release-slug-background"));
    });
    await expect(glyphCanvas).toBeVisible({ timeout: 2_000 });
    await expect
      .poll(() => glyphCanvas.getAttribute("data-fully-resident"), { timeout: 120_000 })
      .toBe("true");
    if (glyphCount >= 5_000) {
      const residencyPageLoads = await page.evaluate(
        () => JSON.parse(document.documentElement.dataset.slugPageRootCounts ?? "[]") as number[],
      );
      expect(residencyPageLoads.length).toBeGreaterThan(2);
      expect(
        await page.evaluate(() => Number(document.documentElement.dataset.slugPageStreams)),
      ).toBeGreaterThan(2);
    }

    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[aria-label="Glyph catalog"] + canvas',
      );
      if (!canvas) throw new Error("Expected resident glyph canvas");
      document.documentElement.dataset.slugHiddenTransitions = "0";
      document.documentElement.dataset.slugPageRootCounts = "[]";
      document.documentElement.dataset.slugPageStreams = "0";
      new MutationObserver(() => {
        if (canvas.style.visibility !== "hidden") return;
        document.documentElement.dataset.slugHiddenTransitions = String(
          Number(document.documentElement.dataset.slugHiddenTransitions) + 1,
        );
      }).observe(canvas, { attributeFilter: ["style"], attributes: true });
    });

    await scrollViewport.evaluate(async (element) => {
      const maximum = element.scrollHeight - element.clientHeight;
      for (let step = 11; step >= 0; step -= 1) {
        element.scrollTop = (maximum * step) / 11;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      for (let step = 1; step <= 11; step += 1) {
        element.scrollTop = (maximum * step) / 11;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    });
    await afterNextPaint(page);

    await expect(glyphCanvas).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugHiddenTransitions))
      .toBe("0");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugPageRootCounts))
      .toBe("[]");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugPageStreams))
      .toBe("0");

    for (const fraction of [0, 0.5, 1]) {
      await scrollViewport.evaluate((element, nextFraction) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * nextFraction;
      }, fraction);
      await afterNextPaint(page);
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
    }
    const search = page.getByPlaceholder("Search glyphs...");
    await search.fill("A");
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");
    await expect(glyphCanvas).toBeVisible();
    await afterNextPaint(page);
    await search.fill("");
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1100, 700);
    });
    await afterNextPaint(page);
    await expect(glyphCanvas).toBeVisible();
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");
    const resizedFrame = await catalogSurface.screenshot();
    const resizedVisibility = await glyphCanvas.evaluate((canvas) => {
      const previous = canvas.style.visibility;
      canvas.style.visibility = "hidden";
      return previous;
    });
    const resizedFrameWithoutGlyphs = await catalogSurface.screenshot();
    await glyphCanvas.evaluate((canvas, previous) => {
      canvas.style.visibility = previous;
    }, resizedVisibility);
    expect(resizedFrame.equals(resizedFrameWithoutGlyphs)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.dataset.slugPageRootCounts)).toBe(
      "[]",
    );
    expect(await page.evaluate(() => document.documentElement.dataset.slugPageStreams)).toBe("0");
  });

  test("restores the current viewport after a topology edit", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });

    await navigateToEditor(page, "53");
    await trackSlugFrameSubmits(page);
    await trackSlugPageLoads(page);
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
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugFrameSubmits), {
        timeout: 30_000,
      })
      .toBe("1");
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    const recoveryDuration = performance.now() - returnStarted;
    const refreshDuration = performance.now() - editStarted;

    const pageLoad = await page.evaluate(() => ({
      counts: JSON.parse(document.documentElement.dataset.slugPageRootCounts ?? "[]") as number[],
      glyphCount: window.shift?.font.glyphRecords().length ?? 0,
    }));
    console.log(
      `Resident catalog topology recovery took ${recoveryDuration.toFixed(0)}ms (${refreshDuration.toFixed(0)}ms from edit)`,
    );
    expect(recoveryDuration).toBeLessThan(1_000);
    expect(pageLoad.counts[0]).toBeGreaterThan(0);
    expect(pageLoad.counts[0]).toBeLessThan(pageLoad.glyphCount);
  });

  test("prioritizes a distant viewport after a topology edit", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    const scrollable = await scrollViewport.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    );
    test.skip(!scrollable, "Catalog needs more than one viewport");

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
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugFrameSubmits), {
        timeout: 30_000,
      })
      .toBe("1");
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    const scrollDuration = performance.now() - scrollStarted;

    console.log(`Resident catalog distant viewport recovery took ${scrollDuration.toFixed(0)}ms`);
    expect(scrollDuration).toBeLessThan(1_000);
  });

  test("restores the current viewport after deleting a source and axis", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });

    await navigateToEditor(page, "53");
    await trackSlugFrameSubmits(page);
    const changed = await page.evaluate(async () => {
      const font = window.shift?.font;
      if (!font || font.getAxes().length === 0 || font.sources.length < 2) return false;

      const source = font.sources.find((candidate) => candidate.id !== font.defaultSource.id);
      const axis = font.getAxes().at(-1);
      if (!source || !axis) return false;

      font.deleteSource(source.id);
      await font.editCoordinator.settled();
      font.deleteAxis(axis.id);
      await font.editCoordinator.settled();
      return true;
    });
    test.skip(!changed, "Font needs at least one axis and two sources");

    const returnStarted = performance.now();
    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.slugFrameSubmits), {
        timeout: 30_000,
      })
      .toBe("1");
    await expect(glyphCanvas).toBeVisible({ timeout: 30_000 });
    const recoveryDuration = performance.now() - returnStarted;

    console.log(`Resident catalog source/axis recovery took ${recoveryDuration.toFixed(0)}ms`);
    expect(recoveryDuration).toBeLessThan(1_000);
  });
});

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

async function trackSlugPageLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const coordinator = window.shift?.font.editCoordinator;
    if (!coordinator) throw new Error("Expected workspace edit coordinator");

    const originalPrepare = coordinator.prepareSlugAtlasPage.bind(coordinator);
    document.documentElement.dataset.slugPageRootCounts = "[]";
    coordinator.prepareSlugAtlasPage = async (glyphIds, alignment) => {
      const counts = JSON.parse(
        document.documentElement.dataset.slugPageRootCounts ?? "[]",
      ) as number[];
      counts.push(glyphIds.length);
      document.documentElement.dataset.slugPageRootCounts = JSON.stringify(counts);
      return originalPrepare(glyphIds, alignment);
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
