import type { Page } from "@playwright/test";
import {
  workspaceTest,
  expect,
  DESIGNSPACE_FONT_PATH,
  navigateToEditor,
} from "./fixtures/electronApp";
import { editorSidebar, openVariationControls } from "./fixtures/appLocators";

const test = workspaceTest.extend({ startupFontPath: DESIGNSPACE_FONT_PATH });

async function outlinePixelCount(page: Page): Promise<number> {
  return page.locator("#scene-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Expected scene canvas context");

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (blue > red + 10 && red > green + 5) count++;
    }
    return count;
  });
}

test("moves matched points in every selected source as one edit", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  const source = await page.evaluate(() => {
    const session = window.shiftSession!;
    return session.font.sources.find(({ id }) => id !== session.editor.activeSourceId);
  });
  if (!source) throw new Error("Expected comparison source");

  await controls
    .getByTestId(`source-${source.id}`)
    .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect
    .poll(() =>
      page.evaluate(() => window.shiftSession!.editor.editingLayerMatchesCell.peek().size),
    )
    .toBe(1);

  const drag = await editor.selectVisiblePoint();
  const referenceBefore = await editor.pointPosition(drag.id);
  const target = await page.evaluate((referencePointId) => {
    const session = window.shiftSession!;
    const [layerMatch] = session.editor.editingLayerMatchesCell.peek().values();
    if (!layerMatch?.complete) throw new Error("Expected complete layer match");
    const targetPointId = layerMatch.points.find(
      ({ referenceId }) => referenceId === referencePointId,
    )?.targetId;
    const node = session.editor.scene.nodesOfKind("glyph")[0];
    const targetLayer = node
      ? session.editor.glyphForId(node.glyphId)?.layerForId(layerMatch.targetLayerId)
      : null;
    const point = targetPointId ? targetLayer?.point(targetPointId) : null;
    if (!targetPointId || !point) throw new Error("Expected matched target point");

    return {
      layerId: layerMatch.targetLayerId,
      pointId: targetPointId,
      position: { x: point.x, y: point.y },
    };
  }, drag.id);

  await editor.dragPoint(drag);
  const referenceAfter = await editor.pointPosition(drag.id);
  const targetAfter = await page.evaluate(({ layerId, pointId }) => {
    const node = window.shiftSession!.editor.scene.nodesOfKind("glyph")[0];
    const point = node
      ? window.shiftSession!.editor.glyphForId(node.glyphId)?.layerForId(layerId)?.point(pointId)
      : null;
    if (!point) throw new Error("Expected matched target point");

    return { x: point.x, y: point.y };
  }, target);
  expect(targetAfter).toEqual({
    x: target.position.x + referenceAfter.x - referenceBefore.x,
    y: target.position.y + referenceAfter.y - referenceBefore.y,
  });

  await editor.undo();
  await expect.poll(() => editor.pointPosition(drag.id)).toEqual(referenceBefore);
  await expect
    .poll(() =>
      page.evaluate(({ layerId, pointId }) => {
        const node = window.shiftSession!.editor.scene.nodesOfKind("glyph")[0];
        const point = node
          ? window
              .shiftSession!.editor.glyphForId(node.glyphId)
              ?.layerForId(layerId)
              ?.point(pointId)
          : null;
        return point ? { x: point.x, y: point.y } : null;
      }, target),
    )
    .toEqual(target.position);
});

test("selects displayed objects at an interpolated instance", async ({ page, editor }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  const instanceId = await page.evaluate(() => {
    const font = window.shiftSession!.font;
    return font.namedInstances.find(
      (instance) =>
        !font.sourceAt(
          new Map(
            font
              .getAxes()
              .map((axis) => [axis.id, instance.location.values[axis.id] ?? axis.default]),
          ),
        ),
    )?.id;
  });
  if (!instanceId) throw new Error("Expected an interpolated instance");

  await controls.getByTestId(`instance-${instanceId}`).click();
  await expect
    .poll(() => page.evaluate(() => window.shiftSession!.editor.activeSourceId))
    .toBeNull();
  const pointId = await page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0];
    const point = node
      ? editor.glyphForId(node.glyphId)?.geometryAt(editor.externalLocation).allPoints[0]
      : null;
    if (!point) throw new Error("Expected an interpolated point");

    return point.id;
  });

  const sidebar = editorSidebar(page);
  await sidebar.getByRole("tab", { name: "Objects", exact: true }).click();
  await sidebar.getByTestId(`object-${pointId}`).click();
  await expect.poll(() => editor.selectionIds()).toEqual([pointId]);
});

test("source selection and visibility controls show comparison outlines", async ({ page }) => {
  await navigateToEditor(page, "53");
  const controls = await openVariationControls(page);
  const fixture = await page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const font = window.shiftSession!.font;
    const source = font.sources.find(({ id }) => id !== editor.activeSourceId);
    const instance = font.namedInstances[0];
    const axis = font
      .getAxes()
      .find(({ role, minimum, maximum }) => role === "external" && minimum !== maximum);
    return { source, instance, axis, activeSourceId: editor.activeSourceId };
  });
  if (!fixture.source || !fixture.instance || !fixture.axis || !fixture.activeSourceId) {
    throw new Error("Expected variable source, instance, and axis fixtures");
  }

  const baseline = await outlinePixelCount(page);
  const sourceButton = controls.getByTestId(`source-${fixture.source.id}`);
  const sourceRow = sourceButton.locator("..");
  const sourceMenu = sourceRow.getByLabel(`Actions for ${fixture.source.name}`);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect(sourceMenu).toHaveCSS("opacity", "0");
  const activeSourceRow = controls.getByTestId(`source-${fixture.activeSourceId}`).locator("..");
  await expect(activeSourceRow.getByLabel(/^(Show|Hide) outline$/)).toHaveCount(0);
  const showSourceOutline = sourceRow.getByLabel("Show outline");
  await expect(showSourceOutline).toHaveCount(1);
  await sourceRow.hover();
  await expect(sourceMenu).toHaveCSS("opacity", "1");

  await showSourceOutline.click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.shiftSession!.editor.activeSourceId)).toBe(
    fixture.activeSourceId,
  );
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await sourceRow.hover();
  await sourceRow.getByLabel("Hide outline").click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  await sourceButton.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.shiftSession!.editor.activeSourceId)).toBe(
    fixture.activeSourceId,
  );
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);

  await sourceRow.hover();
  await sourceRow.getByLabel("Hide outline").click();
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);
  const toggleSourceModifier = process.platform === "darwin" ? "Meta" : "Control";
  await sourceButton.click({ modifiers: [toggleSourceModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await sourceButton.click({ modifiers: [toggleSourceModifier] });
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);

  await sourceRow.hover();
  await sourceRow.getByLabel("Hide outline").click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);
  await sourceRow.hover();
  await sourceRow.getByLabel("Show outline").click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);

  await page.keyboard.down("Space");
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);
  await page.keyboard.up("Space");
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);

  await page.keyboard.press("Escape");
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await sourceRow.hover();
  await sourceRow.getByLabel("Hide outline").click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  const toggleAllSources = process.platform === "darwin" ? "Meta+e" : "Control+e";
  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await page.keyboard.press(toggleAllSources);
  await expect(sourceButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  await controls.getByLabel("Show all source outlines").click();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  const inheritedSourcePixelCount = await outlinePixelCount(page);
  await sourceRow.getByLabel("Hide outline").click();
  await expect.poll(() => outlinePixelCount(page)).toBeLessThan(inheritedSourcePixelCount);
  await sourceRow.hover();
  await sourceRow.getByLabel("Show outline").click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await controls.getByLabel("Hide all source outlines").click();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await sourceRow.hover();
  await sourceRow.getByLabel("Hide outline").click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  const instanceRow = controls.getByTestId(`instance-${fixture.instance.id}`).locator("..");
  await instanceRow.hover();
  await instanceRow.getByLabel("Show outline").click();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await controls.getByLabel("Show all instance outlines").click();
  await controls.getByLabel("Hide all instance outlines").click();
  await expect.poll(() => outlinePixelCount(page)).toBeGreaterThan(baseline);
  await instanceRow.hover();
  await instanceRow.getByLabel("Hide outline").click();
  await page.locator("#interactive-canvas").hover();
  await expect.poll(() => outlinePixelCount(page)).toBe(baseline);

  const sliderBounds = await controls
    .getByRole("slider", { name: fixture.axis.name, exact: true })
    .boundingBox();
  const valueBounds = await controls
    .getByLabel(`${fixture.axis.name} value`, { exact: true })
    .boundingBox();
  const axisMenuBounds = await controls
    .getByLabel(`Actions for ${fixture.axis.name}`)
    .boundingBox();
  if (!sliderBounds || !valueBounds || !axisMenuBounds) throw new Error("Expected axis controls");
  expect(sliderBounds.x).toBeLessThan(valueBounds.x);
  expect(valueBounds.x).toBeLessThan(axisMenuBounds.x);
});
