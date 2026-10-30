import fs from "node:fs";
import type { Locator, Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import { previewTest as test, expect } from "./fixtures/perfApp";
import {
  editorShell,
  fontNavigation,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphProperties,
  openFirstCatalogGlyph,
  settingsDetails,
} from "./fixtures/appLocators";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  afterNextPaint,
  expectCompleteResidency,
  gpuAvailable,
  paintsGlyphs,
} from "./fixtures/glyphCatalogProbe";
import { previewGlyphState, previewLoadState } from "./fixtures/previewSession";

test.describe("retained font source Grid preview", () => {
  test("opens through home with complete source residency and no authored workspace", async ({
    page,
    editor,
  }) => {
    const glyphCanvas = await expectResidentPreviewGrid(editor);

    expect(await editor.documentState()).toBeNull();
    expect(await previewLoadState(page)).toEqual({ authoredWorkspace: false, loadedGlyphCount: 0 });
    await expectPaintedGrid(page, glyphCanvas);

    await expect(page.locator("header")).toBeVisible();
    await expect(fontNavigation(page)).toBeVisible();
    await expect(glyphProperties(page)).toBeVisible();
  });

  test("renders a preview glyph with read-only properties and no authored state", async ({
    page,
    editor,
  }) => {
    await expectResidentPreviewGrid(editor);
    const glyphId = await openFirstPreviewGlyph(editor);

    const readOnlyGlyphInputs = glyphProperties(page).locator("input:disabled");
    await expect(readOnlyGlyphInputs).toHaveCount(3);
    for (const input of await readOnlyGlyphInputs.all()) await expect(input).not.toHaveValue("");

    expect(await previewGlyphState(page, glyphId)).toEqual({
      hasEntry: true,
      hasAuthoredRecord: false,
      layerCount: 0,
    });
    expect(Number.isSafeInteger(Number(glyphId))).toBe(false);

    const sceneCanvas = page.locator("#scene-canvas");
    const editorSurface = editorShell(page);
    const editorFrame = await editorSurface.screenshot();
    await sceneCanvas.evaluate((canvas) => {
      canvas.style.visibility = "hidden";
    });
    const editorWithoutScene = await editorSurface.screenshot();
    await sceneCanvas.evaluate((canvas) => {
      canvas.style.visibility = "";
    });
    expect(editorFrame.equals(editorWithoutScene)).toBe(false);
    await expect(editorShell(page).getByLabel("Create source")).toBeDisabled();
  });

  test("returns to the resident Grid without reading the source or rebuilding the atlas", async ({
    page,
    editor,
    sourcePath,
  }) => {
    const glyphCanvas = await expectResidentPreviewGrid(editor);
    const builds = await glyphCanvas.getAttribute("data-atlas-build-count");
    const glyphId = await openFirstPreviewGlyph(editor);

    // A removed source exposes any later filesystem read of the retained projection.
    fs.rmSync(sourcePath);
    await editorShell(page).getByLabel("Font overview").click();
    await page.waitForURL(/#\/home$/);
    await expectPaintedGrid(page, glyphCanvas);
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");
    await expect(glyphCanvas).toHaveAttribute("data-atlas-build-count", builds ?? "");

    expect(await openFirstPreviewGlyph(editor)).toBe(glyphId);
    await expect(glyphCanvas).toHaveAttribute("data-atlas-build-count", builds ?? "");
  });

  test("shows preview font settings with disabled authoring controls", async ({ page, editor }) => {
    await expect.poll(async () => (await editor.fontOverview()).mode).toBe("preview");

    await page.getByRole("button", { name: "Settings" }).click();
    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await expect(settingsDialog).toBeVisible();
    await expect(page.getByText("Read-only preview")).toBeHidden();

    const styleNameInput = settingsDialog.getByLabel("Style Name");
    await expect(styleNameInput).toHaveValue("Regular");
    await expect(styleNameInput).toBeDisabled();

    const fontControls = settingsDetails(page).locator("input, textarea");
    await expect.poll(() => fontControls.count()).toBeGreaterThan(0);
    await expect
      .poll(() =>
        fontControls.evaluateAll((controls) =>
          controls.every((control) => control.matches(":disabled")),
        ),
      )
      .toBe(true);

    await settingsDialog.getByRole("button", { name: "Sources", exact: true }).click();
    const createSource = settingsDialog.getByLabel("Create source");
    await expect(createSource).toHaveAttribute("aria-disabled", "true");
    await createSource.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Create source");
    const sourceControls = settingsDialog.locator("main input");
    await expect.poll(() => sourceControls.count()).toBeGreaterThan(0);
    await expect
      .poll(() =>
        sourceControls.evaluateAll((controls) =>
          controls.every((control) => control.matches(":disabled")),
        ),
      )
      .toBe(true);

    await settingsDialog.getByLabel("Close settings").click();
    await expect(settingsDialog).toBeHidden();
  });
});

async function expectResidentPreviewGrid(editor: EditorDriver): Promise<Locator> {
  const page = editor.page;
  await expect.poll(() => gpuAvailable(page)).toBe(true);
  await expect.poll(async () => (await editor.fontOverview()).mode).toBe("preview");

  const glyphCanvas: Locator = glyphCatalogCanvas(page);
  await expectCompleteResidency(glyphCanvas);
  return glyphCanvas;
}

/** Proves the Grid canvas contributes pixels beyond the surrounding catalog chrome. */
async function expectPaintedGrid(page: Page, glyphCanvas: Locator): Promise<void> {
  await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete");
  await afterNextPaint(page);
  expect(await paintsGlyphs(glyphCatalogSurface(page), glyphCanvas)).toBe(true);
}

async function openFirstPreviewGlyph(editor: EditorDriver): Promise<GlyphId> {
  const page = editor.page;
  const glyphId = await openFirstCatalogGlyph(page);
  await editor.waitForCanvasRender();
  return glyphId;
}
