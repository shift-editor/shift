import type { Page } from "@playwright/test";
import type { GlyphId, GlyphName } from "@shift/types";
import { expect, workspaceTest as test } from "./fixtures/electronApp";

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
  await page.getByRole("button", { name: "Display all glyphs" }).click();
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

  const authored = await page.evaluate(async () => {
    const editor = window.shift?.editor;
    if (!editor) throw new Error("Expected editor");

    const inserted = editor.insertContent({
      contours: [
        {
          closed: true,
          points: [
            { x: 0, y: 0, pointType: "onCurve", smooth: false },
            { x: 100, y: 0, pointType: "onCurve", smooth: false },
            { x: 100, y: 100, pointType: "onCurve", smooth: false },
            { x: 0, y: 100, pointType: "onCurve", smooth: false },
          ],
        },
      ],
    });
    if (!inserted) throw new Error("Expected inserted contour");

    await editor.font.editCoordinator.settled();
    return inserted.length;
  });
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
