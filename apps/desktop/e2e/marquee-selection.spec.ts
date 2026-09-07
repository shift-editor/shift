import type { Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import { documentWorkspaceTest as test, expect } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";

async function pointTargets(page: Page) {
  return page.evaluate(() => {
    const editor = window.shift?.editor;
    const node = editor?.scene.nodesOfKind("glyph")[0];
    const layer = node ? editor?.glyphForId(node.glyphId)?.layerForSource(node.sourceId) : null;
    if (!editor || !node || !layer) throw new Error("Expected authored glyph outline");

    return layer.allPoints.map((point) => ({
      id: point.id,
      pointType: point.pointType,
      screen: editor.projectSceneToScreen({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      }),
    }));
  });
}

async function hasBlueStroke(page: Page, canvasId: string, point: Point2D): Promise<boolean> {
  return page.locator(`#${canvasId}`).evaluate(async (element, point) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const context = (element as HTMLCanvasElement).getContext("2d");
    if (!context) throw new Error("Expected 2D canvas context");
    const pixels = context.getImageData(
      Math.round(point.x) - 2,
      Math.round(point.y) - 2,
      5,
      5,
    ).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index + 3]! > 0 &&
        pixels[index + 2]! > pixels[index]! + 40 &&
        pixels[index + 1]! > pixels[index]! + 20
      )
        return true;
    }
    return false;
  }, point);
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
  await expect.poll(() => pointTargets(page)).toEqual([]);

  const canvas = page.locator("#interactive-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected interactive canvas bounds");
  await page.getByRole("button", { name: "Pen Tool (P)" }).click();
  await canvas.click({ position: { x: bounds.width * 0.3, y: bounds.height * 0.7 } });
  await canvas.click({ position: { x: bounds.width * 0.45, y: bounds.height * 0.45 } });
  await canvas.click({ position: { x: bounds.width * 0.7, y: bounds.height * 0.3 } });
  await page.getByRole("button", { name: "Select Tool (V)" }).click();
  await expect.poll(async () => (await pointTargets(page)).length).toBe(3);
});

test("Shift-marquee preserves segment highlights and freezes the old box until release", async ({
  page,
}, testInfo) => {
  const [first, second, third] = await pointTargets(page);
  if (!first || !second || !third) throw new Error("Expected three points");
  const canvas = page.locator("#interactive-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected interactive canvas bounds");

  await page.mouse.move(bounds.x + first.screen.x - 20, bounds.y + second.screen.y - 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + second.screen.x + 20, bounds.y + first.screen.y + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.shift?.editor.selection.ids))
    .toEqual([first.id, second.id]);

  const segment = {
    x: (first.screen.x + second.screen.x) / 2,
    y: (first.screen.y + second.screen.y) / 2,
  };
  const oldBox = { x: second.screen.x, y: segment.y };
  const newBox = { x: third.screen.x, y: (first.screen.y + third.screen.y) / 2 };
  await page.keyboard.down("Shift");
  await page.mouse.move(bounds.x + third.screen.x - 18, bounds.y + third.screen.y - 18);

  for (const stage of ["before", "pressed", "dragging", "released"]) {
    switch (stage) {
      case "pressed":
        await page.mouse.down();
        break;
      case "dragging":
        await page.mouse.move(bounds.x + third.screen.x + 18, bounds.y + third.screen.y + 18, {
          steps: 5,
        });
        await expect
          .poll(() => page.evaluate(() => window.shift?.editor.toolCell.peek()?.state.type))
          .toBe("brushing");
        break;
      case "released":
        await page.mouse.up();
        break;
    }

    await expect
      .poll(() => page.evaluate(() => window.shift?.editor.selection.ids))
      .toEqual(
        stage === "dragging" || stage === "released"
          ? [first.id, second.id, third.id]
          : [first.id, second.id],
      );
    const highlighted = await hasBlueStroke(page, "scene-canvas", segment);
    const oldBoxVisible = await hasBlueStroke(page, "interactive-canvas", oldBox);
    const newBoxVisible = await hasBlueStroke(page, "interactive-canvas", newBox);
    await page.screenshot({ path: testInfo.outputPath(`shift-marquee-${stage}.png`) });
    await testInfo.attach(`shift-marquee-${stage}`, {
      path: testInfo.outputPath(`shift-marquee-${stage}.png`),
      contentType: "image/png",
    });
    expect(highlighted, `selected segment at ${stage}`).toBe(true);
    expect(oldBoxVisible, `old selection box at ${stage}`).toBe(stage !== "released");
    expect(newBoxVisible, `combined selection box at ${stage}`).toBe(stage === "released");
  }
  await page.keyboard.up("Shift");
});

test("a partially selected line stays unhighlighted until both endpoints are selected", async ({
  page,
}) => {
  const [first, second] = await pointTargets(page);
  if (!first || !second) throw new Error("Expected line endpoints");
  const canvas = page.locator("#interactive-canvas");
  const segment = {
    x: (first.screen.x + second.screen.x) / 2,
    y: (first.screen.y + second.screen.y) / 2,
  };

  await canvas.click({ position: first.screen });
  expect(await hasBlueStroke(page, "scene-canvas", segment)).toBe(false);
  await canvas.click({ position: second.screen, modifiers: ["Shift"] });
  expect(await hasBlueStroke(page, "scene-canvas", segment)).toBe(true);
  await canvas.click({ position: first.screen, modifiers: ["Shift"] });
  expect(await hasBlueStroke(page, "scene-canvas", segment)).toBe(false);
});

test("a cubic is highlighted only when its controls and endpoints are selected", async ({
  page,
}) => {
  const [first, second] = await pointTargets(page);
  if (!first || !second) throw new Error("Expected line endpoints");
  const canvas = page.locator("#interactive-canvas");
  const segment = {
    x: (first.screen.x + second.screen.x) / 2,
    y: (first.screen.y + second.screen.y) / 2,
  };
  await canvas.click({ position: segment, modifiers: ["Alt"] });
  await expect.poll(async () => (await pointTargets(page)).length).toBe(5);
  const controls = (await pointTargets(page)).filter((point) => point.pointType === "offCurve");
  expect(controls).toHaveLength(2);

  await canvas.click({ position: first.screen });
  await canvas.click({ position: second.screen, modifiers: ["Shift"] });
  expect(await hasBlueStroke(page, "scene-canvas", segment)).toBe(false);
  await canvas.click({ position: controls[0]!.screen, modifiers: ["Shift"] });
  expect(await hasBlueStroke(page, "scene-canvas", segment)).toBe(false);
  await canvas.click({ position: controls[1]!.screen, modifiers: ["Shift"] });
  expect(await hasBlueStroke(page, "scene-canvas", segment)).toBe(true);
  await canvas.click({ position: controls[0]!.screen, modifiers: ["Shift"] });
  expect(await hasBlueStroke(page, "scene-canvas", segment)).toBe(false);
});
