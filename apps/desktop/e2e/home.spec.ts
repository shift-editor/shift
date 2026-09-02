import type { Locator, Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import {
  clickFirstCatalogGlyph,
  clickFirstCatalogGlyphName,
  glyphCatalogRenderer,
  glyphCatalogSurface,
} from "./fixtures/appLocators";

test.describe("Home view", () => {
  test("glyph grid matches snapshot", async ({ page }) => {
    await expect(page).toHaveScreenshot("home-glyph-grid.png");
  });

  test("resets both sidebars to the same default width", async ({ page }) => {
    const layout = page.getByTestId("home-layout-panels");
    const leftSidebar = page.getByTestId("left-sidebar-panel");
    const rightSidebar = page.getByTestId("right-sidebar-panel");
    const leftDivider = page.getByRole("separator", { name: "Resize left sidebar" });
    const rightDivider = page.getByRole("separator", { name: "Resize right sidebar" });
    const defaultWidth = (await elementWidth(layout)) * 0.15;

    await leftDivider.focus();
    await page.keyboard.press("ArrowRight");
    await leftDivider.dispatchEvent("dblclick");

    await rightDivider.focus();
    await page.keyboard.press("ArrowLeft");
    await rightDivider.dispatchEvent("dblclick");

    await expect.poll(() => elementWidth(leftSidebar)).toBeCloseTo(defaultWidth, 0);
    await expect.poll(() => elementWidth(rightSidebar)).toBeCloseTo(defaultWidth, 0);
  });

  test("glyph renderer contributes rendered outlines", async ({ page }) => {
    const catalogSurface = glyphCatalogSurface(page);
    const renderer = glyphCatalogRenderer(page);
    await expect(renderer).toBeVisible({ timeout: 30_000 });

    const renderedFrame = await catalogSurface.screenshot();
    const visibility = await renderer.evaluate((element) => {
      const previous = element.style.visibility;
      element.style.visibility = "hidden";
      return previous;
    });
    const frameWithoutGlyphs = await catalogSurface.screenshot();
    await renderer.evaluate((element, previous) => {
      element.style.visibility = previous;
    }, visibility);

    expect(renderedFrame.equals(frameWithoutGlyphs)).toBe(false);
  });

  test("finds encoded characters and unencoded glyph names", async ({ page }) => {
    const search = page.getByPlaceholder("Search glyphs...");
    const surface = glyphCatalogSurface(page);
    const encodedId = await page.evaluate(() => {
      const font = window.shift?.font;
      if (!font) throw new Error("Expected font");

      const handle = font.glyphHandleForUnicode(0x41);
      return font.recordForName(handle.name)?.id;
    });

    await search.fill("A");
    await expect(surface).toHaveAttribute("data-first-glyph-id", encodedId ?? "");

    await page.getByRole("button", { name: "Create glyph", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.shift?.font.glyphRecords().some((glyph) => glyph.name.startsWith("newGlyph")) ??
            false,
        ),
      )
      .toBe(true);
    const unencoded = await page.evaluate(() =>
      window.shift?.font.glyphRecords().find((glyph) => glyph.name.startsWith("newGlyph")),
    );
    if (!unencoded) throw new Error("Expected unencoded glyph");

    await search.fill(unencoded.name);
    await expect(surface).toHaveAttribute("data-filtered-glyph-count", "1");
    await expect(surface).toHaveAttribute("data-first-glyph-id", unencoded.id);
  });

  test("explains why source creation is unavailable without axes", async ({ page }) => {
    await page.evaluate(async () => {
      const font = window.shift?.font;
      if (!font) throw new Error("Expected font");

      for (const axis of font.getAxes()) font.deleteAxis(axis.id);
      await font.editCoordinator.settled();
    });

    const createSource = page.getByRole("button", { name: "Create source", exact: true });
    const explanation = page.getByRole("tooltip");
    await expect(createSource).toHaveAttribute("aria-disabled", "true");

    await createSource.hover();
    await expect(explanation).toHaveText("Create an axis before adding another source");

    await page.mouse.move(600, 300);
    await expect(explanation).toBeHidden();
    await createSource.focus();
    await expect(explanation).toHaveText("Create an axis before adding another source");
  });

  test("keeps a renamed glyph visible until the catalog confirms its new name", async ({
    page,
  }) => {
    const glyph = await createQuickGlyph(page);
    const nextName = `${glyph.name}.renamed`;
    await page.getByPlaceholder("Search glyphs...").fill(glyph.name);
    await expect(glyphCatalogSurface(page)).toHaveAttribute("data-filtered-glyph-count", "1");
    await afterNextPaint(page);
    await clickFirstCatalogGlyphName(page);

    const input = page.getByLabel("Glyph name", { exact: true });
    await input.fill(nextName);
    const remainedVisible = observeRenameTransition(page, glyph.id, nextName);
    await input.press("Enter");

    expect(await remainedVisible).toBe(true);
    await expect(input).toHaveCount(0);
    await expect(glyphCatalogRenderer(page)).toHaveAttribute("data-first-glyph-name", nextName);
  });

  test("keeps the selected renderer when returning from the editor", async ({ page }) => {
    const renderer = glyphCatalogRenderer(page);
    await expect(renderer).toBeVisible({ timeout: 30_000 });
    await expect(renderer).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await afterNextPaint(page);
    const rendererKind = await renderer.getAttribute("data-glyph-catalog-renderer");
    const initialSize = await renderer.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });

    await clickFirstCatalogGlyph(page);
    await page.waitForURL(/#\/editor\//);
    await afterNextPaint(page);

    await expect(renderer).toBeAttached();

    await page.getByRole("button", { name: "Display all glyphs" }).click();
    await page.waitForURL(/#\/home/);
    await afterNextPaint(page);

    await expect(renderer).toBeVisible();
    await expect(renderer).toHaveAttribute("data-glyph-catalog-renderer", rendererKind ?? "");
    await expect
      .poll(() =>
        renderer.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      )
      .toEqual(initialSize);
  });
});

async function elementWidth(element: Locator): Promise<number> {
  return (await element.boundingBox())?.width ?? 0;
}

async function createQuickGlyph(page: Page) {
  await page.getByRole("button", { name: "Create glyph", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.shift?.font.glyphRecords().find((glyph) => glyph.name.startsWith("newGlyph")) ??
          null,
      ),
    )
    .not.toBeNull();

  const glyph = await page.evaluate(() =>
    window.shift?.font.glyphRecords().find((record) => record.name.startsWith("newGlyph")),
  );
  if (!glyph) throw new Error("Expected new glyph");

  return glyph;
}

async function observeRenameTransition(
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

async function afterNextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
