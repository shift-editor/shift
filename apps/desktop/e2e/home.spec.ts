import type { Locator, Page } from "@playwright/test";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import {
  clickFirstCatalogGlyph,
  clickFirstCatalogGlyphName,
  glyphCatalogRenderer,
  glyphCatalogSurface,
  glyphProperties,
} from "./fixtures/appLocators";

test.describe("Home view", () => {
  test("glyph grid matches snapshot", async ({ page }) => {
    await expect(page).toHaveScreenshot("home-glyph-grid.png");
  });

  test("language coverage filters the glyph grid", async ({ page }) => {
    await page.getByRole("button", { name: "Latin", exact: true }).click();
    const english = page
      .getByRole("button")
      .filter({ has: page.getByText("English", { exact: true }) });
    await expect(english).toContainText(/\d+\/\d+/);
    await expect(page).toHaveScreenshot("home-language-coverage.png");

    const presentCount = (await english.textContent())?.match(/(\d+)\/\d+/)?.[1];
    if (!presentCount) throw new Error("Expected English coverage count");

    await english.click();
    await expect(english).toHaveAttribute("data-active", "true");
    await expect(glyphCatalogSurface(page)).toHaveAttribute(
      "data-filtered-glyph-count",
      presentCount,
    );
    await expect(page).toHaveScreenshot("home-language-filtered.png");
  });

  test("navigation highlights Home or Settings without leaving both active", async ({ page }) => {
    const grid = page.getByRole("button", {
      name: "Font overview",
      exact: true,
      includeHidden: true,
    });
    const info = page.getByRole("button", {
      name: "Settings",
      exact: true,
      includeHidden: true,
    });
    await page.mouse.move(0, 0);
    const activeColor = await grid.evaluate((element) => getComputedStyle(element).color);
    const inactiveColor = await info.evaluate((element) => getComputedStyle(element).color);
    expect(activeColor).not.toBe(inactiveColor);
    await expect(grid).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(info).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    await info.click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(info).toHaveCSS("color", activeColor);
    await expect(grid).toHaveCSS("color", inactiveColor);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
    await expect(grid).toHaveCSS("color", activeColor);
    await expect(info).toHaveCSS("color", inactiveColor);

    await clickFirstCatalogGlyph(page);
    await page.waitForURL(/#\/editor\//);
    const editorGrid = page.getByRole("button", { name: "Font overview", exact: true });
    const editorInfo = page.getByRole("button", { name: "Settings", exact: true });
    await page.mouse.move(0, 0);
    await expect(editorGrid).toHaveCSS("color", inactiveColor);
    await expect(editorInfo).toHaveCSS("color", inactiveColor);
    await expect(editorGrid).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await editorGrid.hover();
    await expect(editorGrid).toHaveCSS("color", inactiveColor);
    await expect(editorGrid).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("selected category uses one background across its heading and children", async ({
    page,
  }) => {
    await page.getByText("Punctuation", { exact: true }).click();
    await expect(page.getByRole("button", { name: "General", exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    const screenshot = await page.screenshot({
      path: test.info().outputPath("home-category-active.png"),
      animations: "disabled",
    });
    await expect(screenshot).toMatchSnapshot("home-category-active.png");
  });

  test("shows an empty Glyph section before a glyph is selected", async ({ page }) => {
    const properties = glyphProperties(page);
    const fields = ["Left sidebearing", "Right sidebearing", "Advance width"];

    await expect(properties.getByRole("heading", { name: "Glyph", exact: true })).toBeVisible();
    await expect(properties.getByText("—", { exact: true })).toHaveCount(2);
    for (const field of fields) {
      await expect(properties.getByLabel(field)).toBeDisabled();
      await expect(properties.getByLabel(field)).toHaveValue("");
    }
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

  test("toolbar toggles both sidebars without reflowing their contents", async ({ page }) => {
    const layout = page.getByTestId("home-layout-panels");
    const leftPanel = layout.getByTestId("left-sidebar-panel");
    const rightPanel = layout.getByTestId("right-sidebar-panel");
    const leftContent = page.getByRole("complementary", { name: "Font navigation" });
    const rightContent = page.getByRole("complementary", { name: "Glyph properties" });
    const catalogSurface = glyphCatalogSurface(page);
    const leftWidth = await elementWidth(leftContent);
    const rightWidth = await elementWidth(rightContent);

    await page.getByRole("button", { name: "Toggle left sidebar" }).click();
    await expect.poll(() => elementWidth(leftPanel)).toBe(0);
    await expect
      .poll(async () => Math.abs((await elementWidth(leftContent)) - leftWidth))
      .toBeLessThanOrEqual(1);

    const catalogSamples = await catalogSurface.evaluate(async (element) => {
      const catalogPanel = element.parentElement;
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle right sidebar"]',
      );
      if (!catalogPanel || !button) {
        throw new Error("Expected catalog panel and right sidebar toggle");
      }

      const samples: Array<{ catalogWidth: number; panelWidth: number }> = [];
      const startedAt = performance.now();
      button.click();
      await new Promise<void>((resolve) => {
        const sample = () => {
          samples.push({
            catalogWidth: element.getBoundingClientRect().width,
            panelWidth: catalogPanel.getBoundingClientRect().width,
          });
          if (performance.now() - startedAt >= 250) {
            resolve();
            return;
          }

          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });

      return samples;
    });
    for (let index = 1; index < catalogSamples.length; index += 1) {
      const previous = catalogSamples[index - 1];
      const current = catalogSamples[index];
      expect(current!.panelWidth).toBeGreaterThanOrEqual(previous!.panelWidth - 1);
      expect(Math.abs(current!.catalogWidth - current!.panelWidth)).toBeLessThanOrEqual(1);
    }
    expect(catalogSamples.at(-1)!.panelWidth - catalogSamples[0]!.panelWidth).toBeGreaterThan(10);
    await expect.poll(() => elementWidth(rightPanel)).toBe(0);
    await expect
      .poll(async () => Math.abs((await elementWidth(rightContent)) - rightWidth))
      .toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Toggle right sidebar" }).click();
    await expect.poll(() => elementWidth(rightPanel)).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Toggle left sidebar" }).click();
    await expect.poll(() => elementWidth(leftPanel)).toBeGreaterThan(0);
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

  test("keeps unavailable source creation discoverable without axes", async ({ page }) => {
    await page.evaluate(async () => {
      const font = window.shift?.font;
      if (!font) throw new Error("Expected font");

      for (const axis of font.getAxes()) font.deleteAxis(axis.id);
      await font.editCoordinator.settled();
    });

    const createSource = page.getByRole("button", { name: "Create source", exact: true });
    const tooltip = page.getByRole("tooltip");
    await expect(createSource).toHaveAttribute("aria-disabled", "true");

    await createSource.hover();
    await expect(tooltip).toHaveText("Create source");

    await page.mouse.move(600, 300);
    await expect(tooltip).toBeHidden();
    await createSource.focus();
    await expect(tooltip).toHaveText("Create source");
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

    await page.getByRole("button", { name: "Font overview" }).click();
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
