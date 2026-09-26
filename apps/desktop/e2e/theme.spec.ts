import { colorThemes } from "../src/renderer/src/lib/themes";
import type { Page } from "@playwright/test";
import type { ThemeId } from "../src/renderer/src/lib/themes";
import { workspaceTest as test, expect, waitForWorkspaceReady } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  clickFirstCatalogGlyph,
  glyphCatalogSurface,
  waitForEditorReady,
} from "./fixtures/appLocators";
import { expectCanvasSnapshot, expectPageSnapshot } from "./fixtures/snapshots";

/** Persists a theme selection, reloads the workspace, and proves the theme is applied. */
async function useTheme(page: Page, themeId: ThemeId): Promise<void> {
  await page.evaluate((id) => localStorage.setItem("themeSelection", id), themeId);
  await page.reload();
  await waitForWorkspaceReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", themeId);
}

/** Opens S with every point selected so glyph, handles, and selection chrome are all drawn. */
async function openSelectedS(editor: EditorDriver): Promise<void> {
  await editor.openGlyphByUnicode("53");
  await editor.selectAll();
  expect(await editor.selectionIds()).toHaveLength(await editor.pointCount());
  // Park the pointer outside the canvas so no hover highlight is part of the golden.
  await editor.page.mouse.move(1, 1);
}

test.describe("Theme", () => {
  // Shift Light uses stylesheet defaults; every other theme maps its palette to canvas tokens
  // through a light or a dark branch, so one theme of each branch covers the mapping.
  for (const themeId of ["shift-dark", "solarized-light"] as const) {
    test(`${themeId} paints glyph, handles, and selection from theme tokens`, async ({
      page,
      editor,
    }) => {
      await useTheme(page, themeId);
      await openSelectedS(editor);

      await expectCanvasSnapshot(editor, `canvas-S-all-selected-${themeId}.png`);
    });
  }

  test("dark editor chrome matches snapshot", async ({ page, editor }) => {
    await useTheme(page, "shift-dark");
    await editor.openGlyphByUnicode("53");
    await page.mouse.move(1, 1);

    await expectPageSnapshot(page, "editor-shift-dark.png");
  });

  test("selects and persists a classic color theme", async ({ page }) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: /Nord/ }).click();

    const nord = colorThemes.find(({ id }) => id === "nord");
    if (!nord) throw new Error("Expected the Nord theme");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim(),
        ),
      )
      .toBe(nord.palette.base00);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
  });

  test("keeps viewport input live after a theme change and a Home round trip", async ({
    page,
    editor,
  }) => {
    const catalog = glyphCatalogSurface(page);
    await expect(catalog).toBeVisible();
    const glyphId = await catalog.getAttribute("data-first-glyph-id");
    if (!glyphId) throw new Error("Expected a catalog glyph");

    await clickFirstCatalogGlyph(page);
    await waitForEditorReady(page, glyphId);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: /Dracula/ }).click();
    await page.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("button", { name: "Font overview" }).click();
    await page.waitForURL(/#\/home$/);
    await expect(catalog).toBeVisible();

    await clickFirstCatalogGlyph(page);
    await waitForEditorReady(page, glyphId);
    await editor.waitForCanvasRender();

    const bounds = await editor.canvasBounds();
    const viewport = () =>
      page.evaluate(() => {
        const { pan, zoom } = window.shift!.editor;
        return { pan: { x: pan.x, y: pan.y }, zoom };
      });
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

    const beforePan = await viewport();
    await page.mouse.wheel(40, 30);
    await expect
      .poll(async () => (await viewport()).pan)
      .toEqual({ x: beforePan.pan.x - 40, y: beforePan.pan.y - 30 });

    const beforeZoom = await viewport();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await viewport()).zoom).toBeGreaterThan(beforeZoom.zoom);

    await editor.dragCanvas({
      from: { x: 5, y: 5 },
      to: { x: bounds.width - 5, y: bounds.height - 5 },
      steps: 5,
    });
    await expect.poll(async () => (await editor.selectionIds()).length).toBeGreaterThan(0);
  });

  test("redraws the active canvas renderers when the theme changes", async ({
    electronApp,
    page,
    editor,
  }) => {
    await editor.openGlyphByUnicode("41");
    await editor.waitForCanvasRender();

    // Selected handles use the theme accent, so both renderers have themed pixels to repaint.
    await editor.selectAll();
    await editor.waitForCanvasRender();

    const sceneCanvas = page.locator("#scene-canvas");
    const markerCanvas = page.locator("#marker-canvas");
    const sceneScreenshotOptions = { style: "#scene-canvas { background: white; }" };
    const markerScreenshotOptions = { style: "#marker-canvas { background: white; }" };
    const sceneBefore = await sceneCanvas.screenshot(sceneScreenshotOptions);
    const markersBefore = await markerCanvas.screenshot(markerScreenshotOptions);
    // Precondition, not a colour oracle: the marker layer must have drawn the selected handles.
    const markersDrawn = await electronApp.evaluate(({ nativeImage }, png) => {
      const bitmap = nativeImage.createFromBuffer(Buffer.from(png, "base64")).toBitmap();
      return bitmap.some((channel) => channel < 250);
    }, markersBefore.toString("base64"));
    expect(markersDrawn).toBe(true);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("radio", { name: /Nord/ }).click();
    await page.getByRole("button", { name: "Close settings" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
    await expect
      .poll(async () => (await sceneCanvas.screenshot(sceneScreenshotOptions)).equals(sceneBefore))
      .toBe(false);
    await expect
      .poll(async () =>
        (await markerCanvas.screenshot(markerScreenshotOptions)).equals(markersBefore),
      )
      .toBe(false);
  });
});
