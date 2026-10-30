import fs from "node:fs";
import path from "node:path";
import { themeById } from "../src/renderer/src/lib/themes";
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
import { configDirectory, imageHasInk, setTheme } from "./fixtures/appearance";
import { expectCanvasSnapshot, expectPageSnapshot } from "./fixtures/snapshots";

/** Writes a theme selection to config.toml, reloads the workspace, and proves the theme is applied. */
async function useTheme(page: Page, themeId: ThemeId): Promise<void> {
  await setTheme(page, themeId);
  await page.reload();
  await waitForWorkspaceReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-color-theme", themeId);
}

/** Writes `themes/<id>.toml` with Nord's palette, overriding the colors in `changes`. */
async function writeThemeFile(
  page: Page,
  id: string,
  { name = "Rice", appearance = "dark", changes = {}, colors = {} }: ThemeFileOptions = {},
): Promise<void> {
  const nord = themeById("nord");
  const palette = Object.entries({ ...nord.palette, ...changes }).map(
    ([key, color]) => `${key} = "${color}"`,
  );
  const directory = path.join(path.dirname(await configFile(page)), "themes");
  fs.mkdirSync(directory, { recursive: true });
  const source: string[] = [
    `name = "${name}"`,
    `appearance = "${appearance}"`,
    "[palette]",
    ...palette,
    "",
  ];
  const overrides = Object.entries(colors).map(([key, color]) => `"${key}" = "${color}"`);
  if (overrides.length > 0) source.push("[colors]", ...overrides, "");
  fs.writeFileSync(path.join(directory, `${id}.toml`), source.join("\n"));
}

interface ThemeFileOptions {
  name?: string;
  appearance?: "light" | "dark";
  changes?: Record<string, string>;
  /** Written as the `[colors]` override table. */
  colors?: Record<string, string>;
}

async function cssVariable(page: Page, name: string): Promise<string> {
  return page
    .locator("html")
    .evaluate((root, variable) => getComputedStyle(root).getPropertyValue(variable).trim(), name);
}

/** This build's config.toml in the test's isolated user data. */
async function configFile(page: Page): Promise<string> {
  const directory = await configDirectory(page);
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

    const nord = themeById("nord");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "nord");
    await expect.poll(() => cssVariable(page, "--color-background")).toBe(nord.palette.base00);

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

  test("lists the bundled themes and applies one", async ({ page }) => {
    await openAppearance(page);
    await chooseTheme(page, "Dark", "Catppuccin Mocha");

    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "catppuccin-mocha");
    await expect.poll(() => cssVariable(page, "--color-background")).toBe("#1e1e2e");
    expect(fs.readFileSync(await configFile(page), "utf8")).toBe(`theme = "catppuccin-mocha"\n`);
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

  test("lists a theme file and applies its palette when selected", async ({ page }) => {
    await writeThemeFile(page, "rice", { name: "Rice", changes: { base00: "#101820" } });
    await openAppearance(page);

    await page.getByRole("tab", { name: "Dark", exact: true }).click();
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    const rice = page
      .getByRole("group", { name: "Your themes" })
      .getByRole("option", { name: "Rice", exact: true });
    await expect(rice).toHaveAttribute("title", /themes[\\/]rice\.toml$/);
    await rice.click();

    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "rice");
    await expect.poll(() => cssVariable(page, "--color-background")).toBe("#101820");
    expect(fs.readFileSync(await configFile(page), "utf8")).toBe(`theme = "rice"\n`);
  });

  test("overrides one derived color from a theme file", async ({ page }) => {
    await writeThemeFile(page, "rice", { colors: { accent: "#ff9e64" } });
    await setTheme(page, "rice");

    await expect.poll(() => cssVariable(page, "--color-accent")).toBe("#ff9e64");
    const nord = themeById("nord");
    expect(await cssVariable(page, "--editor-handle-primary-stroke")).toBe(nord.palette.base0D);
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
    const viewport = async () => ({
      pan: await editor.canvasOffset(),
      zoom: await editor.zoomLevel(),
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
      // Clear of the sidebar dividers, whose grab areas reach 8px into the canvas.
      from: { x: 12, y: 12 },
      to: { x: bounds.width - 12, y: bounds.height - 12 },
      modifiers: [],
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
    expect(await imageHasInk(electronApp, markersBefore)).toBe(true);

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

  test("redraws the canvas when the selected theme file is edited", async ({ page, editor }) => {
    await writeThemeFile(page, "rice");
    await setTheme(page, "rice");
    await expect(page.locator("html")).toHaveAttribute("data-color-theme", "rice");
    await editor.openGlyphByUnicode("41");
    await editor.selectAll();
    await editor.waitForCanvasRender();

    const sceneCanvas = page.locator("#scene-canvas");
    const markerCanvas = page.locator("#marker-canvas");
    const sceneBefore = await sceneCanvas.screenshot();
    const markersBefore = await markerCanvas.screenshot();

    // Glyph fill (base06) and selected handles (base0D) change; the theme id does not.
    await writeThemeFile(page, "rice", { changes: { base06: "#ff8800", base0D: "#00ff88" } });

    await expect.poll(() => cssVariable(page, "--editor-handle-primary-stroke")).toBe("#00ff88");
    await expect.poll(async () => (await sceneCanvas.screenshot()).equals(sceneBefore)).toBe(false);
    await expect
      .poll(async () => (await markerCanvas.screenshot()).equals(markersBefore))
      .toBe(false);
  });
});
