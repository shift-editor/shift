import type { GlyphName } from "@shift/types";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";
import { pointPosition } from "./fixtures/editorInteractions";

test.beforeEach(async ({ page }) => {
  const glyphId = await page.evaluate(async () => {
    const workspace = window.shift!;
    const record = workspace.editor.createGlyph("snapSelection" as GlyphName);
    await workspace.font.editCoordinator.settled();
    return record.id;
  });
  await openGlyphRoute(page, glyphId);
  await page.evaluate(async () => {
    const editor = window.shift!.editor;
    editor.insertContent({
      contours: [
        {
          closed: false,
          points: [
            { x: 100, y: 100, pointType: "onCurve", smooth: false },
            { x: 300, y: 100, pointType: "onCurve", smooth: false },
            { x: 300, y: 300, pointType: "onCurve", smooth: false },
          ],
        },
      ],
    });
    await window.shift!.font.editCoordinator.settled();
    editor.selection.clear();
    editor.zoomToFit();
  });
});

for (const pointIndex of [0, 2]) {
  test(`snaps the ${pointIndex === 0 ? "first" : "final"} line endpoint around its neighbor`, async ({
    page,
  }) => {
    const canvas = page.locator("#interactive-canvas");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Expected canvas");
    const drag = await page.evaluate((pointIndex) => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
      const point = layer.allPoints[pointIndex]!;
      const pivot = layer.allPoints[1]!;
      const down = editor.projectSceneToScreen({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      });
      const end = editor.projectSceneToScreen(
        pointIndex === 0
          ? { x: 220 + node.position.x, y: 160 + node.position.y }
          : { x: 360 + node.position.x, y: 180 + node.position.y },
      );
      down.x = Math.round(down.x);
      down.y = Math.round(down.y);
      end.x = Math.round(end.x);
      end.y = Math.round(end.y);
      const startPos = editor.projectScreenToScene(down);
      const endPos = editor.projectScreenToScene(end);
      const length = Math.hypot(
        point.x + endPos.x - startPos.x - pivot.x,
        point.y + endPos.y - startPos.y - pivot.y,
      );
      const angle = pointIndex === 0 ? (5 * Math.PI) / 6 : Math.PI / 3;
      return {
        id: point.id,
        pivot: pivot.id,
        before: { x: point.x, y: point.y },
        down,
        end,
        expected: { x: pivot.x + length * Math.cos(angle), y: pivot.y + length * Math.sin(angle) },
      };
    }, pointIndex);
    for (const point of [drag.down, drag.end]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.y).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(bounds.width);
      expect(point.y).toBeLessThan(bounds.height);
    }
    await page.mouse.move(bounds.x + drag.down.x, bounds.y + drag.down.y);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    try {
      await page.mouse.move(bounds.x + drag.end.x, bounds.y + drag.end.y);
      await page.evaluate(() => window.shift!.editor.toolManager.flushPointerMoves());
      await expect
        .poll(() => page.evaluate(() => window.shift!.editor.toolIf("select")?.state.type))
        .toBe("translating");
      const preview = await pointPosition(page, drag.id);
      expect(preview.x).toBeCloseTo(drag.expected.x, 4);
      expect(preview.y).toBeCloseTo(drag.expected.y, 4);
      expect(await pointPosition(page, drag.pivot)).toEqual({ x: 300, y: 100 });
      await page.keyboard.up("Shift");
      await page.mouse.up();
      await page.evaluate(async () => window.shift!.font.editCoordinator.settled());
      expect(await pointPosition(page, drag.id)).toEqual(preview);
      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(() => pointPosition(page, drag.id)).toEqual(drag.before);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(() => pointPosition(page, drag.id)).toEqual(preview);
    } finally {
      await page.mouse.up();
      await page.keyboard.up("Shift");
    }
  });
}

test("moves a segment group on one axis but keeps edges and corners as resize targets", async ({
  page,
}) => {
  const canvas = page.locator("#interactive-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected canvas");
  const drag = await page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
    const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
    const positions = [
      { x: 150, y: 100 },
      { x: 300, y: 150 },
      { x: 200, y: 200 },
      { x: 260, y: 280 },
      { x: 100, y: 100 },
      { x: 130, y: 140 },
      { x: 210, y: 180 },
    ];
    const screen = positions.map((point) => {
      const projected = editor.projectSceneToScreen({
        x: point.x + node.position.x,
        y: point.y + node.position.y,
      });
      return { x: Math.round(projected.x), y: Math.round(projected.y) };
    });
    const startPos = editor.projectScreenToScene(screen[2]!);
    const endPos = editor.projectScreenToScene(screen[3]!);
    return {
      screen,
      length: Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y),
      points: layer.allPoints.map((point) => ({ id: point.id, x: point.x, y: point.y })),
    };
  });
  for (const point of drag.screen) {
    expect(point.x).toBeGreaterThan(0);
    expect(point.y).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(bounds.width);
    expect(point.y).toBeLessThan(bounds.height);
  }
  await canvas.click({ position: drag.screen[0] });
  await canvas.click({ position: drag.screen[1], modifiers: ["Shift"] });
  await expect.poll(() => page.evaluate(() => window.shift!.editor.selection.ids.length)).toBe(2);
  await page.mouse.move(bounds.x + drag.screen[2]!.x, bounds.y + drag.screen[2]!.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  try {
    await page.mouse.move(bounds.x + drag.screen[3]!.x, bounds.y + drag.screen[3]!.y);
    await page.evaluate(() => window.shift!.editor.toolManager.flushPointerMoves());
    await expect
      .poll(() => page.evaluate(() => window.shift!.editor.toolIf("select")?.state.type))
      .toBe("translating");
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.evaluate(async () => window.shift!.font.editCoordinator.settled());
    for (const point of drag.points) {
      const position = await pointPosition(page, point.id);
      expect(position.x).toBeCloseTo(point.x, 4);
      expect(position.y).toBeCloseTo(point.y + drag.length, 4);
    }
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => pointPosition(page, drag.points[0]!.id)).toEqual({ x: 100, y: 100 });
    for (const [down, end] of [
      [drag.screen[4]!, drag.screen[5]!],
      [drag.screen[0]!, drag.screen[6]!],
    ]) {
      await page.mouse.move(bounds.x + down.x, bounds.y + down.y);
      await page.keyboard.down("Shift");
      await page.mouse.down();
      await page.mouse.move(bounds.x + end.x, bounds.y + end.y);
      await page.evaluate(() => window.shift!.editor.toolManager.flushPointerMoves());
      await expect
        .poll(() => page.evaluate(() => window.shift!.editor.toolIf("select")?.state.type))
        .toBe("resizing");
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.keyboard.up("Shift");
      expect(await pointPosition(page, drag.points[0]!.id)).toEqual({ x: 100, y: 100 });
    }
  } finally {
    await page.mouse.up();
    await page.keyboard.up("Shift");
  }
});
