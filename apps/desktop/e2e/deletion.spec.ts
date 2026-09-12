import fs from "node:fs";
import type { Page } from "@playwright/test";
import {
  documentWorkspaceTest as test,
  expect,
  waitForWorkspaceReady,
} from "./fixtures/electronApp";
import { EditorDriver } from "./fixtures/EditorDriver";
import {
  clickApplicationMenuItem,
  killApp,
  quitApp,
  relaunchApp,
  runCommand,
} from "./fixtures/documentLifecycle";

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

test.beforeEach(async ({ page, editor }) => {
  await editor.openGlyphByName("I");
  await editor.selectTool("select");
  await editor.selectAll();
  await editor.press("Backspace");
  await expect.poll(() => editor.outline()).toEqual([]);

  await editor.selectTool("pen");
  const canvas = editor.canvas;
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
  await editor.selectTool("select");
  await expect
    .poll(async () => (await editor.outline())[0]?.segments)
    .toEqual(["cubic", "cubic", "cubic", "cubic"]);
  await expect.poll(() => renderedSegments(page)).toBe(true);
});

test("Delete fits a selected point and undo/redo restores the exact outline", async ({
  page,
  editor,
}, testInfo) => {
  const before = await editor.outline();
  const selected = before[0].onCurvePoints[2];
  await editor.clickPoint(selected.id);
  await page.screenshot({ path: testInfo.outputPath("before-delete.png") });
  await testInfo.attach("before-delete", {
    path: testInfo.outputPath("before-delete.png"),
    contentType: "image/png",
  });

  await editor.press("Delete");
  await expect
    .poll(async () => (await editor.outline())[0].segments)
    .toEqual(["cubic", "cubic", "cubic"]);
  const after = await editor.outline();
  expect(after[0].points.some((point) => point.id === selected.id)).toBe(false);
  expect(after[0].onCurvePoints).toEqual(
    before[0].onCurvePoints.filter((point) => point.id !== selected.id),
  );
  await expect.poll(() => renderedSegments(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("after-fitted-delete.png") });
  await testInfo.attach("after-fitted-delete", {
    path: testInfo.outputPath("after-fitted-delete.png"),
    contentType: "image/png",
  });

  await editor.undo();
  await expect.poll(() => editor.outline()).toEqual(before);
  await editor.redo();
  await expect.poll(() => editor.outline()).toEqual(after);
});

test("Delete joins corner endpoints as a line without creating handles", async ({
  page,
  editor,
}, testInfo) => {
  await editor.selectAll();
  await editor.press("Backspace");
  await expect.poll(() => editor.outline()).toEqual([]);
  await editor.selectTool("pen");
  const canvas = editor.canvas;
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected interactive canvas bounds");
  for (const point of [
    { x: 0.2, y: 0.6 },
    { x: 0.5, y: 0.3 },
    { x: 0.8, y: 0.6 },
  ]) {
    await canvas.click({ position: { x: point.x * bounds.width, y: point.y * bounds.height } });
  }
  await editor.selectTool("select");
  await expect.poll(async () => (await editor.outline())[0]?.segments).toEqual(["line", "line"]);
  const before = await editor.outline();
  await editor.clickPoint(before[0].points[1].id);
  await page.screenshot({ path: testInfo.outputPath("before-line-delete.png") });
  await testInfo.attach("before-line-delete", {
    path: testInfo.outputPath("before-line-delete.png"),
    contentType: "image/png",
  });

  await editor.press("Delete");
  await expect.poll(async () => (await editor.outline())[0]?.segments).toEqual(["line"]);
  const after = await editor.outline();
  expect(after[0].points).toEqual([before[0].points[0], before[0].points[2]]);
  await expect.poll(() => renderedSegments(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("after-line-delete.png") });
  await testInfo.attach("after-line-delete", {
    path: testInfo.outputPath("after-line-delete.png"),
    contentType: "image/png",
  });

  await editor.undo();
  await expect.poll(() => editor.outline()).toEqual(before);
  await editor.redo();
  await expect.poll(() => editor.outline()).toEqual(after);
});

test("Shift+Backspace leaves two open fragments and survives save/reopen", async ({
  page,
  editor,
  electronApp,
  saveShiftPath,
  testRoot,
}, testInfo) => {
  const before = await editor.outline();
  const selected = before[0].onCurvePoints[2];
  await editor.clickPoint(selected.id);
  await editor.press("Shift+Backspace");
  await expect
    .poll(async () => (await editor.outline()).map((contour) => contour.segments))
    .toEqual([["cubic"], ["cubic"]]);
  const after = await editor.outline();
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

  await editor.undo();
  await expect.poll(() => editor.outline()).toEqual(before);
  await editor.redo();
  await expect.poll(() => editor.outline()).toEqual(after);
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
    const reopenedEditor = new EditorDriver(reopenedPage);
    await reopenedEditor.openGlyph(glyphId);
    expect(await reopenedEditor.outline()).toEqual(after);
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
    editor,
  }) => {
    const before = await editor.outline();
    await editor.clickPoint(before[0].points[1].id);
    await editor.press(key);
    await expect
      .poll(async () => (await editor.outline())[0].segments)
      .toEqual(["line", "cubic", "cubic", "cubic"]);
    expect((await editor.outline())[0].points).toEqual([
      before[0].points[0],
      ...before[0].points.slice(3),
    ]);
    await expect.poll(() => renderedSegments(page)).toBe(true);
  });
}

test("native Delete uses fitted deletion rather than raw point removal", async ({
  page,
  editor,
  electronApp,
}) => {
  const before = await editor.outline();
  const selected = before[0].onCurvePoints[2];
  await editor.clickPoint(selected.id);
  await clickApplicationMenuItem(page, electronApp, "edit.deleteSelection");
  await expect
    .poll(async () => (await editor.outline())[0].segments)
    .toEqual(["cubic", "cubic", "cubic"]);
  expect((await editor.outline())[0].points.some((point) => point.id === selected.id)).toBe(false);
  await expect.poll(() => renderedSegments(page)).toBe(true);
});
