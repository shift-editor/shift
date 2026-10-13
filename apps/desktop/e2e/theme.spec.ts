import fs from "node:fs";
import path from "node:path";
import { colorThemes } from "../src/renderer/src/lib/themes";
import type { Page } from "@playwright/test";
import type { ThemeId } from "../src/renderer/src/lib/themes";
import { workspaceTest as test, expect, waitForWorkspaceReady } from "./fixtures/electronApp";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  clickFirstCatalogGlyph,
  editorToolbar,
  glyphCatalogSurface,
  waitForEditorReady,
} from "./fixtures/appLocators";
import { expectCanvasSnapshot, expectPageSnapshot } from "./fixtures/snapshots";

/** Writes a theme selection to config.toml, reloads the workspace, and proves the theme is applied. */
async function useTheme(page: Page, themeId: ThemeId): Promise<void> {
  await page.evaluate((id) => window.shiftHost!.config.setTheme(id), themeId);
  await page.reload();
  await waitForWorkspaceReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", themeId);
}

/** This build's config.toml in the test's isolated user data. */
async function configFile(page: Page): Promise<string> {
  const { directory } = await page.evaluate(() => window.shiftHost!.config.state());
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, "config.toml");
}

/** Opens Settings → Appearance. */
async function openAppearance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
}

/** Switches to `mode` in Settings → Appearance and picks `themeName` for it. */
async function chooseTheme(page: Page, mode: "Light" | "Dark", themeName: string): Promise<void> {
  await page.getByRole("tab", { name: mode, exact: true }).click();
  await page.getByRole("button", { name: `${mode} theme`, exact: true }).click();
  await page.getByRole("option", { name: themeName, exact: true }).click();
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
    test(
      `${themeId} paints glyph, handles, and selection from theme tokens`,
      { tag: "@golden" },
      async ({ page, editor }) => {
        await useTheme(page, themeId);
        await openSelectedS(editor);

        await expectCanvasSnapshot(editor, `canvas-S-all-selected-${themeId}.png`);
      },
    );
  }

  test("dark editor chrome matches snapshot", { tag: "@golden" }, async ({ page, editor }) => {
    await useTheme(page, "shift-dark");
    await editor.openGlyphByUnicode("53");
    await page.mouse.move(1, 1);

    await expectPageSnapshot(page, "editor-shift-dark.png", [editorToolbar(page)]);
  });

  test("selects and persists a classic color theme", async ({ page }) => {
    await openAppearance(page);
    await chooseTheme(page, "Dark", "Nord");

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

    expect(fs.readFileSync(await configFile(page), "utf8")).toBe(`theme = "nord"\n`);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
  });

  test("saves a light and a dark theme for system mode", async ({ page }) => {
    await openAppearance(page);
    await chooseTheme(page, "Light", "Gruvbox Light");
    await page.getByRole("tab", { name: "System", exact: true }).click();
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await page.getByRole("option", { name: "Nord", exact: true }).click();

    await expect
      .poll(async () => fs.readFileSync(await configFile(page), "utf8"))
      .toBe(`theme = { mode = "system", light = "gruvbox-light", dark = "nord" }\n`);
  });

  test("applies a theme chosen by editing config.toml", async ({ page }) => {
    const file = await configFile(page);
    fs.writeFileSync(file, `# my rice\ntheme = "gruvbox-dark"\n`);

    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "gruvbox-dark");
  });

  test("keeps the theme and reports the line when config.toml breaks", async ({ page }) => {
    const file = await configFile(page);
    fs.writeFileSync(file, `theme = "dracula"\n`);
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "dracula");

    fs.writeFileSync(file, `theme = "nord\n`);
    await openAppearance(page);

    await expect(page.getByRole("list", { name: "Config problems" })).toContainText(
      "config.toml:1:",
    );
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "dracula");
    await page.getByRole("tab", { name: "Light", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Not saved");
    expect(fs.readFileSync(file, "utf8")).toBe(`theme = "nord\n`);
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
    await openAppearance(page);
    await chooseTheme(page, "Dark", "Dracula");
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

    await openAppearance(page);
    await chooseTheme(page, "Dark", "Nord");
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
