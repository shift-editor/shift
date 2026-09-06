import type { Page } from "@playwright/test";
import { documentWorkspaceTest as test, expect } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";

async function pointTargets(page: Page) {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const layer = node ? editor?.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!editor || !node || !layer) throw new Error("Expected authored glyph outline");

    return layer.allPoints
      .filter((point) => point.pointType === "onCurve")
      .slice(0, 2)
      .map((point) => ({
        id: point.id,
        position: { x: point.x, y: point.y },
        screen: editor.projectSceneToScreen({
          x: point.x + node.position.x,
          y: point.y + node.position.y,
        }),
      }));
  });
}

async function pointAndSelection(page: Page, pointId: string) {
  return page.evaluate(async (id) => {
    const editor = window.shift?.editor;
    if (!editor) throw new Error("Expected editor");
    await editor.font.editCoordinator.settled();

    const node = editor.scene.nodesOfKind("glyph")[0];
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    const point = layer?.allPoints.find((candidate) => candidate.id === id);
    if (!point) throw new Error("Expected editable point");

    return {
      point: { x: point.x, y: point.y },
      selection: editor.selection.ids,
    };
  }, pointId);
}

test.beforeEach(async ({ page }) => {
  const glyphId = await page.evaluate(
    () => window.shift?.font.glyphRecords().find((glyph) => glyph.name === "I")?.id,
  );
  if (!glyphId) throw new Error("Expected I glyph");

  await openGlyphRoute(page, glyphId);
  await page.getByRole("button", { name: "Select Tool (V)" }).click();
});

test("Shift-click selection is undoable and redoable", async ({ page }, testInfo) => {
  const [first, second] = await pointTargets(page);
  if (!first || !second) throw new Error("Expected two on-curve points");
  const canvas = page.locator("#interactive-canvas");

  await canvas.click({ position: first.screen });
  await canvas.click({ position: second.screen, modifiers: ["Shift"] });
  await expect
    .poll(() => page.evaluate(() => window.shift?.editor.selection.ids))
    .toEqual([first.id, second.id]);
  await page.screenshot({ path: testInfo.outputPath("shift-click-selected.png") });
  await testInfo.attach("shift-click-selected", {
    path: testInfo.outputPath("shift-click-selected.png"),
    contentType: "image/png",
  });

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => page.evaluate(() => window.shift?.editor.selection.ids))
    .toEqual([first.id]);
  await page.screenshot({ path: testInfo.outputPath("shift-click-undone.png") });
  await testInfo.attach("shift-click-undone", {
    path: testInfo.outputPath("shift-click-undone.png"),
    contentType: "image/png",
  });

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(() => page.evaluate(() => window.shift?.editor.selection.ids))
    .toEqual([first.id, second.id]);
});

test("selecting and dragging one point is one history action", async ({ page }, testInfo) => {
  const [target] = await pointTargets(page);
  if (!target) throw new Error("Expected an on-curve point");
  const canvas = page.locator("#interactive-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected interactive canvas bounds");
  await page.screenshot({ path: testInfo.outputPath("before-select-and-drag.png") });
  await testInfo.attach("before-select-and-drag", {
    path: testInfo.outputPath("before-select-and-drag.png"),
    contentType: "image/png",
  });

  await page.mouse.move(bounds.x + target.screen.x, bounds.y + target.screen.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + target.screen.x + 30, bounds.y + target.screen.y + 20, {
    steps: 5,
  });
  await page.mouse.up();

  const moved = await pointAndSelection(page, target.id);
  expect(moved.point).not.toEqual(target.position);
  expect(moved.selection).toEqual([target.id]);
  await page.screenshot({ path: testInfo.outputPath("selected-and-dragged.png") });
  await testInfo.attach("selected-and-dragged", {
    path: testInfo.outputPath("selected-and-dragged.png"),
    contentType: "image/png",
  });

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => pointAndSelection(page, target.id))
    .toEqual({
      point: target.position,
      selection: [],
    });
  await page.screenshot({ path: testInfo.outputPath("selected-and-dragged-undone.png") });
  await testInfo.attach("selected-and-dragged-undone", {
    path: testInfo.outputPath("selected-and-dragged-undone.png"),
    contentType: "image/png",
  });

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => pointAndSelection(page, target.id)).toEqual(moved);
  await page.screenshot({ path: testInfo.outputPath("selected-and-dragged-redone.png") });
  await testInfo.attach("selected-and-dragged-redone", {
    path: testInfo.outputPath("selected-and-dragged-redone.png"),
    contentType: "image/png",
  });
});
