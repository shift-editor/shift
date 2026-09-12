import type { Page } from "@playwright/test";
import type { GlyphId, GlyphName } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";
import { openCatalogGlyph } from "./fixtures/appLocators";
import { addSquare } from "./fixtures/editorInteractions";

interface NavigationGlyphs {
  firstId: GlyphId;
  secondId: GlyphId;
}

async function createNavigationGlyphs(page: Page): Promise<NavigationGlyphs> {
  return page.evaluate(async () => {
    const workspace = window.shift;
    if (!workspace) throw new Error("Expected workspace");

    const first = workspace.editor.createGlyph("navigationA" as GlyphName);
    const second = workspace.editor.createGlyph("navigationB" as GlyphName);
    await workspace.font.editCoordinator.settled();
    return { firstId: first.id, secondId: second.id };
  });
}

async function returnHome(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Font overview" }).click();
  await page.waitForURL(/#\/home$/);
}

test("preserves confirmed edits and document history across glyph navigation", async ({
  page,
  editor,
}) => {
  const glyphs = await createNavigationGlyphs(page);
  await editor.openGlyph(glyphs.firstId);

  const authored = await addSquare(page);
  expect(authored).toBe(4);
  await expect
    .poll(() => editor.activeGlyph())
    .toMatchObject({
      glyphId: glyphs.firstId,
      contourCount: 1,
    });

  await returnHome(page);
  await expect.poll(() => editor.activeGlyph()).toBeNull();
  await editor.openGlyph(glyphs.secondId);
  await expect
    .poll(() => editor.activeGlyph())
    .toMatchObject({
      glyphId: glyphs.secondId,
      contourCount: 0,
    });

  await returnHome(page);
  await editor.openGlyph(glyphs.firstId);
  expect(await editor.contourCount()).toBe(1);

  await editor.undo();
  await expect.poll(() => editor.contourCount()).toBe(0);

  await editor.redo();
  await expect.poll(() => editor.contourCount()).toBe(1);
});

test("starts a fresh Pen context after navigating to another glyph", async ({ page, editor }) => {
  const glyphs = await createNavigationGlyphs(page);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await page.getByRole("button", { name: "Pen Tool (P)" }).click();
  const bounds = await editor.canvasBounds();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

  await returnHome(page);
  await openCatalogGlyph(page, "navigationB", glyphs.secondId);
  const secondBounds = await editor.canvasBounds();
  await page.mouse.click(
    secondBounds.x + secondBounds.width / 2,
    secondBounds.y + secondBounds.height / 2,
  );
  await editor.waitForIdle();

  const pointCounts = await page.evaluate(({ firstId, secondId }) => {
    const editor = window.shift?.editor;
    const sourceId = editor?.font.defaultSource.id;
    return {
      first: sourceId ? editor?.glyphForId(firstId)?.layerForSource(sourceId)?.allPoints.length : 0,
      second: sourceId
        ? editor?.glyphForId(secondId)?.layerForSource(sourceId)?.allPoints.length
        : 0,
    };
  }, glyphs);
  expect(pointCounts).toEqual({ first: 1, second: 1 });
});

test("clears transient editor state when navigating between glyphs", async ({ page, editor }) => {
  const glyphs = await createNavigationGlyphs(page);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await addSquare(page);
  await editor.selectVisiblePoint();
  await editor.hoverVisibleUnselectedPoint();

  await returnHome(page);
  await openCatalogGlyph(page, "navigationB", glyphs.secondId);

  await expect
    .poll(async () => {
      const glyph = await editor.activeGlyph();
      return {
        glyphId: glyph?.glyphId,
        selection: await editor.selectionIds(),
        hover: await editor.hoverId(),
        toolState: await editor.toolState(),
      };
    })
    .toEqual({
      glyphId: glyphs.secondId,
      selection: [],
      hover: null,
      toolState: "ready",
    });
  const glyph = await editor.activeGlyph();
  const editing = await page.evaluate(() => window.shift?.editor.editing.nodeIds);
  expect(editing).toEqual([glyph?.nodeId]);

  await returnHome(page);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await expect
    .poll(() => editor.activeGlyph())
    .toMatchObject({
      glyphId: glyphs.firstId,
      contourCount: 1,
    });
});
