import { expect, type Locator, type Page } from "@playwright/test";
import type { AxisId } from "@shift/types";
import { setLocation } from "./fontSetup";

// Instrumentation of the Home glyph catalog's resident GPU Grid: paint waits, published Grid
// state, and DOM observers that record transitions between two reads.

/** Whether the page has WebGPU. */
export async function gpuAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(navigator.gpu));
}

/** Waits for two animation frames, so the next read sees a painted frame. */
export async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Waits for the page's web fonts to load. */
export async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** The page's viewport height in CSS pixels. */
export async function viewportHeight(page: Page): Promise<number> {
  return page.evaluate(() => window.innerHeight);
}

/** Waits until the Grid has rendered its current target location with complete residency. */
export async function waitForSettledGrid(page: Page, glyphCanvas: Locator): Promise<void> {
  await page.evaluate(async () => {
    await window.shift?.font.editCoordinator.settled();
  });
  await afterNextPaint(page);
  await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      glyphCanvas.evaluate(
        (canvas) => canvas.dataset.activeLocation === canvas.dataset.targetLocation,
      ),
    )
    .toBe(true);
}

/**
 * Whether the catalog surface looks different with the glyph canvas shown than hidden, so the
 * canvas has painted glyphs. Restores the canvas's visibility.
 */
export async function paintsGlyphs(surface: Locator, glyphCanvas: Locator): Promise<boolean> {
  const painted = await surface.screenshot();
  const previous = await glyphCanvas.evaluate((canvas: HTMLCanvasElement) => {
    document.documentElement.dataset.slugIgnoreHiddenTransitions = "true";
    const visibility = canvas.style.visibility;
    canvas.style.visibility = "hidden";
    return visibility;
  });
  const withoutGlyphs = await surface.screenshot();
  await glyphCanvas.evaluate((canvas: HTMLCanvasElement, visibility) => {
    canvas.style.visibility = visibility;
    document.documentElement.dataset.slugIgnoreHiddenTransitions = "false";
  }, previous);
  return !painted.equals(withoutGlyphs);
}

/**
 * Starts counting how often the Grid hides its glyph canvas, ignoring the hides
 * {@link paintsGlyphs} makes; read the count with {@link hiddenGlyphCanvasCount}.
 */
export async function countGlyphCanvasHides(page: Page): Promise<void> {
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
}

/** How often the Grid hid its glyph canvas since {@link countGlyphCanvasHides}. */
export async function hiddenGlyphCanvasCount(page: Page): Promise<number> {
  return page.evaluate(() => Number(document.documentElement.dataset.slugHiddenTransitions));
}

/** Starts recording the Grid's readiness changes and canvas hides; read them with {@link observedGridState}. */
export async function trackGridTransitions(page: Page): Promise<void> {
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

/** The readiness changes and canvas hides recorded since {@link trackGridTransitions}. */
export async function observedGridState(page: Page): Promise<{
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

/**
 * Moves the axis `axisId` through `values` and, once the Grid has rendered each, samples its
 * preview height and the catalog's scroll height.
 *
 * @throws {Error} when the Grid does not render a value within 600 frames.
 */
export async function scrubGridGeometry(
  page: Page,
  glyphCanvas: Locator,
  axisId: AxisId,
  values: readonly number[],
): Promise<{ previewHeight: number; scrollHeight: number }[]> {
  const samples: { previewHeight: number; scrollHeight: number }[] = [];
  for (const value of values) {
    const previousLocation = await glyphCanvas.getAttribute("data-active-location");
    await setLocation(page, { [axisId]: value });
    // Sample only once the Grid has rendered this location, never a stale frame.
    const rendered = await page.evaluate(async (previous) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="glyph-catalog-canvas"]',
      );
      if (!canvas) throw new Error("Expected resident glyph canvas");

      for (let frame = 0; frame < 600; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (
          canvas.dataset.activeLocation !== previous &&
          canvas.dataset.activeLocation === canvas.dataset.targetLocation
        ) {
          return true;
        }
      }
      return canvas.dataset.activeLocation !== previous;
    }, previousLocation);
    if (!rendered) throw new Error(`Grid did not render axis value ${value}`);

    samples.push({
      previewHeight: Number(await glyphCanvas.getAttribute("data-preview-height")),
      scrollHeight: await page
        .getByLabel("Glyph catalog", { exact: true })
        .evaluate((viewport) => viewport.scrollHeight),
    });
  }
  return samples;
}

/**
 * Resolves, after the rename field closes, whether the catalog showed `nextName` from the
 * moment it stopped showing the old name until the font confirmed the rename, sampled each
 * frame; false when the old name came back in between.
 */
export async function observeRenameTransition(
  page: Page,
  glyphId: string,
  nextName: string,
): Promise<boolean> {
  return page.evaluate(
    ({ glyphId, nextName }) =>
      new Promise<boolean>((resolve) => {
        function sample(): void {
          const currentName = window.shift?.font
            .glyphRecords()
            .find(({ id }) => id === glyphId)?.name;
          const input = document.querySelector<HTMLInputElement>('[aria-label="Glyph name"]');
          const renderer = [
            ...document.querySelectorAll<HTMLElement>("[data-glyph-catalog-renderer]"),
          ].find((element) => getComputedStyle(element).visibility === "visible");
          if (input) {
            requestAnimationFrame(sample);
            return;
          }

          const visibleName = renderer?.dataset.firstGlyphName;
          if (currentName === nextName) {
            resolve(visibleName === nextName);
            return;
          }
          if (visibleName !== nextName) {
            resolve(false);
            return;
          }

          requestAnimationFrame(sample);
        }

        requestAnimationFrame(sample);
      }),
    { glyphId, nextName },
  );
}
