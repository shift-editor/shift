import fs from "node:fs";
import type { GlyphId } from "@shift/types";
import { previewTest as test, expect } from "./fixtures/perfApp";
import {
  clickFirstCatalogGlyph,
  editorShell,
  firstAxisSlider,
  fontNavigation,
  glyphCatalogCanvas,
  glyphCatalogSurface,
  glyphCatalogViewport,
  glyphProperties,
  settingsDetails,
} from "./fixtures/appLocators";

test.describe("retained font source Grid preview", () => {
  test("opens through home with complete source residency and no authored workspace", async ({
    page,
    sourcePath,
  }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("imported");

    const scrollViewport = glyphCatalogViewport(page);
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = glyphCatalogCanvas(page);
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");

    const state = await page.evaluate(() => {
      const session = window.shiftSession;
      return {
        mode: session?.mode,
        workspace: session?.workspace ?? null,
        authoredGlobal: window.shift ?? null,
        loadedGlyphCount:
          session?.font
            .glyphEntries()
            .filter((entry) => session.editor.glyphForId(entry.id) !== null).length ?? -1,
      };
    });
    const residency = await glyphCanvas.evaluate((canvas) => ({
      residentGlyphCount: Number(canvas.dataset.residentGlyphCount),
      targetGlyphCount: Number(canvas.dataset.targetGlyphCount),
    }));
    expect(state.mode).toBe("imported");
    expect(state.workspace).toBeNull();
    expect(state.authoredGlobal).toBeNull();
    expect(residency.residentGlyphCount).toBeGreaterThan(0);
    expect(residency.residentGlyphCount).toBe(residency.targetGlyphCount);
    expect(state.loadedGlyphCount).toBe(0);

    await expect(page.locator("header")).toBeVisible();
    await expect(fontNavigation(page)).toBeVisible();
    await expect(glyphProperties(page)).toBeVisible();

    await clickFirstCatalogGlyph(page);
    await page.waitForURL(/#\/editor\//);
    const sceneCanvas = page.locator("#scene-canvas");
    await expect(sceneCanvas).toBeVisible();
    await expect(page.locator("#marker-canvas")).toBeVisible();
    const readOnlyGlyphInputs = glyphProperties(page).locator("input:disabled");
    await expect(readOnlyGlyphInputs).toHaveCount(3);
    const readOnlyGlyphValues = await readOnlyGlyphInputs.evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );
    expect(readOnlyGlyphValues.every((value) => value !== "")).toBe(true);

    const selected = await page.evaluate(() => {
      const session = window.shiftSession;
      if (!session) throw new Error("Expected imported font session");

      const encodedGlyphId = window.location.hash.split("/editor/")[1];
      if (!encodedGlyphId) throw new Error("Expected selected glyph route");
      const glyphId = decodeURIComponent(encodedGlyphId) as GlyphId;
      const glyph = session.editor.glyphForId(glyphId);
      return {
        glyphId,
        hasEntry: session.font.entryForId(glyphId) !== null,
        hasAuthoredRecord: session.font.recordForId(glyphId) !== null,
        layerCount: glyph?.layers.length ?? -1,
      };
    });
    expect(selected.hasEntry).toBe(true);
    expect(selected.hasAuthoredRecord).toBe(false);
    expect(selected.layerCount).toBe(0);
    expect(Number.isSafeInteger(Number(selected.glyphId))).toBe(false);

    const inspection = await page.evaluate(() => {
      const editor = window.shiftSession?.editor;
      if (!editor) throw new Error("Expected imported editor");

      const node = editor.scene.nodesOfKind("glyph")[0];
      if (!node) throw new Error("Expected glyph node");
      const glyph = editor.glyphForId(node.glyphId);
      const geometry = glyph?.geometryAt(editor.externalLocation);
      const point = geometry?.allPoints[0];
      if (!geometry || !point) throw new Error("Expected imported point geometry");

      const target = editor.getPointerTarget({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      });
      if (target.kind !== "point") throw new Error(`Expected point hit, received ${target.kind}`);

      editor.selection.select([target.pointId]);
      const object = editor.object(target.pointId);
      if (object?.kind !== "point") throw new Error("Expected selected point object");

      return {
        hitKind: target.kind,
        selected: editor.selection.has(target.pointId),
        resolvesHitPoint: object.geometry.point(target.pointId) !== null,
        geometryValueCount: object.geometry.values.length,
        objectBounds: object.bounds(),
        selectionBounds: editor.selectionBounds(),
        editableLayer: editor.layerForGeometry({ points: [target.pointId] }) !== null,
      };
    });
    expect(inspection).toMatchObject({
      hitKind: "point",
      selected: true,
      resolvesHitPoint: true,
      editableLayer: false,
    });
    expect(inspection.geometryValueCount).toBeGreaterThan(0);
    expect(inspection.objectBounds).not.toBeNull();
    expect(inspection.selectionBounds).not.toBeNull();

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

    // Once the projection and atlas are resident, later navigation must not
    // touch the source or prepare replacement pages. Removing the copied source
    // exposes filesystem reads; rejecting preparePage exposes atlas rebuilds.
    fs.rmSync(sourcePath);
    await page.evaluate(() => {
      const atlas = window.shiftSession?.catalog.atlas;
      if (!atlas) throw new Error("Expected resident atlas");

      atlas.preparePage = async () => {
        throw new Error("resident atlas page was rebuilt");
      };
    });
    const axisCount = await page.evaluate(
      () => window.shiftSession?.catalog.axesCell.value.length ?? 0,
    );
    if (axisCount > 0) {
      const axisSlider = await firstAxisSlider(page);
      const beforeScrub = await sceneCanvas.screenshot();
      const beforeLocation = await page.evaluate(() =>
        Array.from(window.shiftSession?.editor.externalLocation.values() ?? []),
      );
      await axisSlider.press("End");
      await expect
        .poll(() =>
          page.evaluate(() =>
            Array.from(window.shiftSession?.editor.externalLocation.values() ?? []),
          ),
        )
        .not.toEqual(beforeLocation);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      const afterScrub = await sceneCanvas.screenshot();
      expect(afterScrub.equals(beforeScrub)).toBe(false);
    }

    await editorSurface.getByLabel("Create source").click();
    await expect(page.getByText("Read-only preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Read-only preview")).toBeHidden();

    await editorSurface.getByLabel("Display all glyphs").click();
    await page.waitForURL(/#\/home$/);
    await expect(scrollViewport).toBeVisible({ timeout: 1_000 });
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 1_000,
    });
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true", {
      timeout: 1_000,
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    const catalogSurface = glyphCatalogSurface(page);
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

    // Reopening the resident root after its source was removed must reuse the
    // same projection rather than attempting another source read.
    await clickFirstCatalogGlyph(page);
    await page.waitForURL(/#\/editor\//);
    await expect(page.locator("#scene-canvas")).toBeVisible();
    const reopenedGlyphId = await page.evaluate(() => {
      const encodedGlyphId = window.location.hash.split("/editor/")[1];
      return encodedGlyphId ? decodeURIComponent(encodedGlyphId) : null;
    });
    expect(reopenedGlyphId).toBe(selected.glyphId);
  });

  test("shows imported font settings with disabled authoring controls", async ({ page }) => {
    await expect.poll(() => page.evaluate(() => window.shiftSession?.canAuthor)).toBe(false);

    await page.getByLabel(/Display and edit font information/).click();
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
    await expect(settingsDialog.getByLabel("Create source")).toBeDisabled();
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
