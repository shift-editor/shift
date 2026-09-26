import fs from "node:fs";
import type { Locator, Page } from "@playwright/test";
import type { GlyphId } from "@shift/types";
import { previewTest as test, expect } from "./fixtures/perfApp";
import {
  clickFirstCatalogGlyph,
  editorShell,
  fontNavigation,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphProperties,
  settingsDetails,
  waitForEditorReady,
} from "./fixtures/appLocators";
import type { EditorDriver } from "./fixtures/EditorDriver";

test.describe("retained font source Grid preview", () => {
  test("opens through home with complete source residency and no authored workspace", async ({
    page,
  }) => {
    const glyphCanvas = await expectResidentPreviewGrid(page);

    const state = await page.evaluate(() => {
      const session = window.shiftSession;
      return {
        workspace: session?.workspace ?? null,
        authoredGlobal: window.shift ?? null,
        loadedGlyphCount:
          session?.font
            .glyphEntries()
            .filter((entry) => session.editor.glyphForId(entry.id) !== null).length ?? -1,
      };
    });
    expect(state.workspace).toBeNull();
    expect(state.authoredGlobal).toBeNull();
    expect(state.loadedGlyphCount).toBe(0);
    await expectPaintedGrid(page, glyphCanvas);

    await expect(page.locator("header")).toBeVisible();
    await expect(fontNavigation(page)).toBeVisible();
    await expect(glyphProperties(page)).toBeVisible();
  });

  test("renders a preview glyph with read-only properties and no authored state", async ({
    page,
    editor,
  }) => {
    await expectResidentPreviewGrid(page);
    const glyphId = await openFirstPreviewGlyph(editor);

    const readOnlyGlyphInputs = glyphProperties(page).locator("input:disabled");
    await expect(readOnlyGlyphInputs).toHaveCount(3);
    const readOnlyGlyphValues = await readOnlyGlyphInputs.evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );
    expect(readOnlyGlyphValues.every((value) => value !== "")).toBe(true);

    const selected = await page.evaluate((id) => {
      const session = window.shiftSession;
      if (!session) throw new Error("Expected preview font session");

      return {
        hasEntry: session.font.entryForId(id) !== null,
        hasAuthoredRecord: session.font.recordForId(id) !== null,
        layerCount: session.editor.glyphForId(id)?.layers.length ?? -1,
      };
    }, glyphId);
    expect(selected).toEqual({ hasEntry: true, hasAuthoredRecord: false, layerCount: 0 });
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
    const glyphCanvas = await expectResidentPreviewGrid(page);
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

  test("shows preview font settings with disabled authoring controls", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("preview");

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

async function expectResidentPreviewGrid(page: Page): Promise<Locator> {
  await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("preview");

  const glyphCanvas = glyphCatalogCanvas(page);
  await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
    timeout: 30_000,
  });
  await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");
  const residency = await glyphCanvas.evaluate((canvas) => ({
    resident: Number(canvas.dataset.residentGlyphCount),
    target: Number(canvas.dataset.targetGlyphCount),
  }));
  expect(residency.resident).toBeGreaterThan(0);
  expect(residency.resident).toBe(residency.target);
  return glyphCanvas;
}

/** Proves the Grid canvas contributes pixels beyond the surrounding catalog chrome. */
async function expectPaintedGrid(page: Page, glyphCanvas: Locator): Promise<void> {
  await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const catalogSurface = glyphCatalogSurface(page);
  const painted = await catalogSurface.screenshot();
  const visibility = await glyphCanvas.evaluate((canvas) => {
    const previous = canvas.style.visibility;
    canvas.style.visibility = "hidden";
    return previous;
  });
  const withoutGlyphs = await catalogSurface.screenshot();
  await glyphCanvas.evaluate((canvas, previous) => {
    canvas.style.visibility = previous;
  }, visibility);
  expect(painted.equals(withoutGlyphs)).toBe(false);
}

async function openFirstPreviewGlyph(editor: EditorDriver): Promise<GlyphId> {
  const page = editor.page;
  await clickFirstCatalogGlyph(page);
  await page.waitForURL(/#\/editor\//);
  const glyphId = decodeURIComponent(new URL(page.url()).hash.slice("#/editor/".length)) as GlyphId;
  await waitForEditorReady(page, glyphId);
  await editor.waitForCanvasRender();
  return glyphId;
}
