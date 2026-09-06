import fs from "node:fs";
import type { Page } from "@playwright/test";
import {
  documentWorkspaceTest as test,
  expect,
  waitForWorkspaceReady,
} from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";
import {
  clickApplicationMenuItem,
  killApp,
  quitApp,
  relaunchApp,
  runCommand,
} from "./fixtures/documentLifecycle";

async function outline(page: Page) {
  return page.evaluate(async () => {
    const editor = window.shift?.editor;
    if (!editor) throw new Error("Expected editor");
    await editor.font.editCoordinator.settled();
    const node = editor.scene.nodesOfKind("glyph")[0];
    const layer = node ? editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!layer) throw new Error("Expected authored layer");
    return layer.contours.map((contour) => ({
      id: contour.id,
      closed: contour.closed,
      points: contour.points.map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        pointType: point.pointType,
        smooth: point.smooth,
      })),
      segments: contour.segments().map((segment) => segment.type),
    }));
  });
}

async function clickPoint(page: Page, id: string): Promise<void> {
  const position = await page.evaluate((pointId) => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const point = node
      ? editor
          ?.glyphForId(node.glyphId)
          ?.layerForSource(node.sourceId)
          ?.allPoints.find((candidate) => candidate.id === pointId)
      : null;
    if (!editor || !node || !point) throw new Error("Expected editable point");
    return editor.projectSceneToScreen({
      x: point.x + node.position.x,
      y: point.y + node.position.y,
    });
  }, id);
  await page.locator("#interactive-canvas").click({ position });
  await expect.poll(() => page.evaluate(() => window.shift?.editor.selection.ids)).toEqual([id]);
}

async function renderedSegments(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const layer = node ? editor?.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    const canvas = document.querySelector<HTMLCanvasElement>("#scene-canvas");
    const context = canvas?.getContext("2d");
    if (!editor || !node || !layer || !context)
      throw new Error("Expected rendered authored outline");
    const segments = layer.contours.flatMap((contour) => contour.segments());
    return (
      segments.length > 0 &&
      segments.every((segment) => {
        const point = segment.pointAt(0.5);
        const screen = editor.projectSceneToScreen({
          x: point.x + node.position.x,
          y: point.y + node.position.y,
        });
        const pixels = context.getImageData(
          Math.round(screen.x) - 3,
          Math.round(screen.y) - 3,
          7,
          7,
        ).data;
        return pixels.some((value, index) => index % 4 === 3 && value > 0);
      })
    );
  });
}

test.beforeEach(async ({ page }) => {
  const glyphId = await page.evaluate(
    () => window.shift?.font.glyphRecords().find((glyph) => glyph.name === "I")?.id,
  );
  if (!glyphId) throw new Error("Expected I glyph");
  await openGlyphRoute(page, glyphId);
  await page.getByRole("button", { name: "Select Tool (V)" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect.poll(() => outline(page)).toEqual([]);

  await page.getByRole("button", { name: "Pen Tool (P)" }).click();
  const canvas = page.locator("#interactive-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected interactive canvas bounds");
  await canvas.click({ position: { x: bounds.width * 0.1, y: bounds.height * 0.6 } });
  for (const point of [
    { x: 0.3, y: 0.4, dy: -0.03 },
    { x: 0.5, y: 0.3, dy: 0 },
    { x: 0.7, y: 0.4, dy: 0.03 },
    { x: 0.9, y: 0.6, dy: 0.04 },
  ]) {
    await page.mouse.move(bounds.x + point.x * bounds.width, bounds.y + point.y * bounds.height);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + (point.x + 0.04) * bounds.width,
      bounds.y + (point.y + point.dy) * bounds.height,
      { steps: 5 },
    );
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "Select Tool (V)" }).click();
  await expect
    .poll(async () => (await outline(page))[0]?.segments)
    .toEqual(["cubic", "cubic", "cubic", "cubic"]);
  await expect.poll(() => renderedSegments(page)).toBe(true);
});

test("Delete fits a selected point and undo/redo restores the exact outline", async ({
  page,
}, testInfo) => {
  const before = await outline(page);
  const selected = before[0].points.filter((point) => point.pointType === "onCurve")[2];
  await clickPoint(page, selected.id);
  await page.screenshot({ path: testInfo.outputPath("before-delete.png") });
  await testInfo.attach("before-delete", {
    path: testInfo.outputPath("before-delete.png"),
    contentType: "image/png",
  });
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await outline(page))[0].segments)
    .toEqual(["cubic", "cubic", "cubic"]);
  const after = await outline(page);
  expect(after[0].points.some((point) => point.id === selected.id)).toBe(false);
  expect(after[0].points.filter((point) => point.pointType === "onCurve")).toEqual(
    before[0].points.filter((point) => point.pointType === "onCurve" && point.id !== selected.id),
  );
  await expect.poll(() => renderedSegments(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("after-fitted-delete.png") });
  await testInfo.attach("after-fitted-delete", {
    path: testInfo.outputPath("after-fitted-delete.png"),
    contentType: "image/png",
  });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => outline(page)).toEqual(before);
  await expect
    .poll(() => page.evaluate(() => window.shift?.editor.selection.ids))
    .toEqual([selected.id]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => outline(page)).toEqual(after);
  await expect.poll(() => page.evaluate(() => window.shift?.editor.selection.ids)).toEqual([]);
});

test("Delete joins corner endpoints as a line without creating handles", async ({
  page,
}, testInfo) => {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect.poll(() => outline(page)).toEqual([]);
  await page.getByRole("button", { name: "Pen Tool (P)" }).click();
  const canvas = page.locator("#interactive-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected interactive canvas bounds");
  for (const point of [
    { x: 0.2, y: 0.6 },
    { x: 0.5, y: 0.3 },
    { x: 0.8, y: 0.6 },
  ]) {
    await canvas.click({ position: { x: point.x * bounds.width, y: point.y * bounds.height } });
  }
  await page.getByRole("button", { name: "Select Tool (V)" }).click();
  await expect.poll(async () => (await outline(page))[0]?.segments).toEqual(["line", "line"]);
  const before = await outline(page);
  await clickPoint(page, before[0].points[1].id);
  await page.screenshot({ path: testInfo.outputPath("before-line-delete.png") });
  await testInfo.attach("before-line-delete", {
    path: testInfo.outputPath("before-line-delete.png"),
    contentType: "image/png",
  });
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await outline(page))[0]?.segments).toEqual(["line"]);
  const after = await outline(page);
  expect(after[0].points).toEqual([before[0].points[0], before[0].points[2]]);
  await expect.poll(() => renderedSegments(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("after-line-delete.png") });
  await testInfo.attach("after-line-delete", {
    path: testInfo.outputPath("after-line-delete.png"),
    contentType: "image/png",
  });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => outline(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => outline(page)).toEqual(after);
});

test("Shift+Backspace leaves two open fragments and survives save/reopen", async ({
  page,
  electronApp,
  saveShiftPath,
  testRoot,
}, testInfo) => {
  const before = await outline(page);
  const selected = before[0].points.filter((point) => point.pointType === "onCurve")[2];
  await clickPoint(page, selected.id);
  await page.keyboard.press("Shift+Backspace");
  await expect
    .poll(async () => (await outline(page)).map((contour) => contour.segments))
    .toEqual([["cubic"], ["cubic"]]);
  const after = await outline(page);
  expect(after.map((contour) => contour.closed)).toEqual([false, false]);
  expect(after.flatMap((contour) => contour.points)).toEqual([
    ...before[0].points.slice(0, 4),
    ...before[0].points.slice(9),
  ]);
  await expect.poll(() => renderedSegments(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("after-gap-delete.png") });
  await testInfo.attach("after-gap-delete", {
    path: testInfo.outputPath("after-gap-delete.png"),
    contentType: "image/png",
  });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => outline(page)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => outline(page)).toEqual(after);
  await runCommand(page, electronApp, "file.saveAs");
  await expect.poll(() => fs.existsSync(saveShiftPath)).toBe(true);
  const glyphId = await page.evaluate(
    () => window.shift?.editor.scene.nodesOfKind("glyph")[0]?.glyphId,
  );
  if (!glyphId) throw new Error("Expected active glyph");
  await quitApp(electronApp);
  const reopenedApp = await relaunchApp(testRoot, saveShiftPath);
  try {
    const launcher = await reopenedApp.firstWindow();
    const opened = reopenedApp.waitForEvent("window");
    await launcher.getByRole("button", { name: /Load font/ }).click();
    const reopenedPage = await opened;
    await waitForWorkspaceReady(reopenedPage);
    await openGlyphRoute(reopenedPage, glyphId);
    expect(await outline(reopenedPage)).toEqual(after);
    await expect.poll(() => renderedSegments(reopenedPage)).toBe(true);
    await reopenedPage.screenshot({ path: testInfo.outputPath("reopened-gap-delete.png") });
    await testInfo.attach("reopened-gap-delete", {
      path: testInfo.outputPath("reopened-gap-delete.png"),
      contentType: "image/png",
    });
  } finally {
    await killApp(reopenedApp);
  }
});

for (const key of ["Backspace", "Shift+Delete"]) {
  test(`${key} on a cubic handle removes both controls without changing the next curve`, async ({
    page,
  }) => {
    const before = await outline(page);
    await clickPoint(page, before[0].points[1].id);
    await page.keyboard.press(key);
    await expect
      .poll(async () => (await outline(page))[0].segments)
      .toEqual(["line", "cubic", "cubic", "cubic"]);
    expect((await outline(page))[0].points).toEqual([
      before[0].points[0],
      ...before[0].points.slice(3),
    ]);
    await expect.poll(() => renderedSegments(page)).toBe(true);
  });
}

test("native Delete uses fitted deletion rather than raw point removal", async ({
  page,
  electronApp,
}) => {
  const before = await outline(page);
  const selected = before[0].points.filter((point) => point.pointType === "onCurve")[2];
  await clickPoint(page, selected.id);
  await clickApplicationMenuItem(page, electronApp, "edit.deleteSelection");
  await expect
    .poll(async () => (await outline(page))[0].segments)
    .toEqual(["cubic", "cubic", "cubic"]);
  expect((await outline(page))[0].points.some((point) => point.id === selected.id)).toBe(false);
  await expect.poll(() => renderedSegments(page)).toBe(true);
});
