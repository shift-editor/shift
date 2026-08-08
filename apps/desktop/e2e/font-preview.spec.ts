import fs from "node:fs";
import type { GlyphId } from "@shift/types";
import { previewTest as test, expect } from "./fixtures/perfApp";

test.describe("retained font source Grid preview", () => {
  test("opens through home with complete source residency and no authored workspace", async ({
    page,
    sourcePath,
  }) => {
    await expect.poll(() => page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.shiftSession?.mode)).toBe("imported");

    const scrollViewport = page.getByLabel("Glyph catalog");
    await scrollViewport.waitFor({ state: "visible" });
    const glyphCanvas = scrollViewport.locator("..").locator("canvas").first();
    await expect(glyphCanvas).toHaveAttribute("data-grid-readiness", "Complete", {
      timeout: 30_000,
    });
    await expect(glyphCanvas).toHaveAttribute("data-fully-resident", "true");

    const state = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[aria-label="Glyph catalog"] + canvas',
      );
      if (!canvas) throw new Error("Expected resident glyph canvas");

      const session = window.shiftSession;
      return {
        mode: session?.mode,
        workspace: session?.workspace ?? null,
        authoredGlobal: window.shift ?? null,
        residentGlyphCount: Number(canvas.dataset.residentGlyphCount),
        targetGlyphCount: Number(canvas.dataset.targetGlyphCount),
        loadedGlyphCount:
          session?.font
            .glyphEntries()
            .filter((entry) => session.editor.glyphForId(entry.id) !== null).length ?? -1,
      };
    });
    expect(state.mode).toBe("imported");
    expect(state.workspace).toBeNull();
    expect(state.authoredGlobal).toBeNull();
    expect(state.residentGlyphCount).toBeGreaterThan(0);
    expect(state.residentGlyphCount).toBe(state.targetGlyphCount);
    expect(state.loadedGlyphCount).toBe(0);

    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(2);

    await scrollViewport.click({ position: { x: 50, y: 50 } });
    await page.waitForURL(/#\/editor\//);
    const sceneCanvas = page.locator("#scene-canvas");
    await expect(sceneCanvas).toBeVisible();
    await expect(page.locator("#marker-canvas")).toBeVisible();
    const readOnlyGlyphInputs = page.locator("aside").last().locator("input:disabled");
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

    const editorSurface = page.locator(".shift-editor-shell");
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
    const axisSlider = editorSurface.getByRole("slider").first();
    if ((await axisSlider.count()) > 0) {
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

    // Reopening the resident root after its source was removed must reuse the
    // same projection rather than attempting another source read.
    await scrollViewport.click({ position: { x: 50, y: 50 } });
    await page.waitForURL(/#\/editor\//);
    await expect(page.locator("#scene-canvas")).toBeVisible();
    const reopenedGlyphId = await page.evaluate(() => {
      const encodedGlyphId = window.location.hash.split("/editor/")[1];
      return encodedGlyphId ? decodeURIComponent(encodedGlyphId) : null;
    });
    expect(reopenedGlyphId).toBe(selected.glyphId);
  });
});
