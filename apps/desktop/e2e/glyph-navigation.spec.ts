import type { Page } from "@playwright/test";
import type { GlyphId, GlyphName } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";
import { openCatalogGlyph } from "./fixtures/appLocators";
import {
  addSquare,
  hoverVisibleUnselectedPoint,
  selectVisiblePoint,
} from "./fixtures/editorInteractions";

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

async function openGlyph(page: Page, glyphId: GlyphId): Promise<void> {
  await page.evaluate(async (id) => {
    const font = window.shift?.font;
    if (!font) throw new Error("Expected workspace font");

    await font.loadGlyph(id);
    window.location.hash = `#/editor/${encodeURIComponent(id)}`;
  }, glyphId);
  await page.waitForURL(new RegExp(`#/editor/${encodeURIComponent(glyphId)}$`));
  await expect(page.locator("#scene-canvas")).toBeVisible();
}

async function returnHome(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Font overview" }).click();
  await page.waitForURL(/#\/home$/);
}

async function currentGlyph(page: Page) {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    return {
      glyphId: node?.glyphId,
      contourCount: layer?.contours.length,
    };
  });
}

test("preserves confirmed edits and document history across glyph navigation", async ({ page }) => {
  const glyphs = await createNavigationGlyphs(page);
  await openGlyph(page, glyphs.firstId);

  const authored = await addSquare(page);
  expect(authored).toBe(4);
  await expect
    .poll(() => currentGlyph(page))
    .toEqual({
      glyphId: glyphs.firstId,
      contourCount: 1,
    });

  await returnHome(page);
  await expect
    .poll(() => page.evaluate(() => window.shift?.editor.scene.nodesOfKind("glyph").length))
    .toBe(0);
  await openGlyph(page, glyphs.secondId);
  const secondGlyph = await currentGlyph(page);
  expect(secondGlyph).toEqual({ glyphId: glyphs.secondId, contourCount: 0 });

  await returnHome(page);
  await openGlyph(page, glyphs.firstId);
  expect((await currentGlyph(page)).contourCount).toBe(1);

  await page.evaluate(async () => {
    await window.shift?.font.editCoordinator.undo();
  });
  await expect.poll(async () => (await currentGlyph(page)).contourCount).toBe(0);

  await page.evaluate(async () => {
    await window.shift?.font.editCoordinator.redo();
  });
  await expect.poll(async () => (await currentGlyph(page)).contourCount).toBe(1);
});

test("starts a fresh Pen context after navigating to another glyph", async ({ page }) => {
  const glyphs = await createNavigationGlyphs(page);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await page.getByRole("button", { name: "Pen Tool (P)" }).click();
  const canvas = page.locator("#interactive-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected editor canvas");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);

  await returnHome(page);
  await openCatalogGlyph(page, "navigationB", glyphs.secondId);
  const secondBounds = await canvas.boundingBox();
  if (!secondBounds) throw new Error("Expected editor canvas");
  await page.mouse.click(
    secondBounds.x + secondBounds.width / 2,
    secondBounds.y + secondBounds.height / 2,
  );
  await page.evaluate(async () => window.shift?.font.editCoordinator.settled());

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

test("clears transient editor state when navigating between glyphs", async ({ page }) => {
  const glyphs = await createNavigationGlyphs(page);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  await addSquare(page);
  await selectVisiblePoint(page);
  await hoverVisibleUnselectedPoint(page);

  await returnHome(page);
  await openCatalogGlyph(page, "navigationB", glyphs.secondId);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = window.shift?.editor;
        const node = editor?.scene.nodesOfKind("glyph")[0];
        return {
          glyphId: node?.glyphId,
          selection: editor?.selection.ids,
          hover: editor?.hover.id,
          editing: editor?.editing.nodeIds,
          nodeId: node?.id,
          toolState: editor?.toolManager.activeTool?.getState().type,
        };
      }),
    )
    .toEqual({
      glyphId: glyphs.secondId,
      selection: [],
      hover: null,
      editing: expect.any(Array),
      nodeId: expect.any(String),
      toolState: "ready",
    });
  const state = await page.evaluate(() => {
    const editor = window.shift?.editor;
    return { editing: editor?.editing.nodeIds, nodeId: editor?.scene.nodesOfKind("glyph")[0]?.id };
  });
  expect(state.editing).toEqual([state.nodeId]);

  await returnHome(page);
  await openCatalogGlyph(page, "navigationA", glyphs.firstId);
  expect(await currentGlyph(page)).toEqual({ glyphId: glyphs.firstId, contourCount: 1 });
});
