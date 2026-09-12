import type { GlyphName } from "@shift/types";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";
import { pointPosition } from "./fixtures/editorInteractions";

for (const releaseShiftFirst of [true, false]) {
  test(`snaps a cubic handle every 15 degrees when Shift is released ${releaseShiftFirst ? "before" : "after"} mouseup`, async ({
    page,
  }) => {
    const glyphId = await page.evaluate(async () => {
      const workspace = window.shift!;
      const record = workspace.editor.createGlyph("snapHandles" as GlyphName);
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
              { x: 200, y: 100, pointType: "offCurve", smooth: false },
              { x: 300, y: 100, pointType: "offCurve", smooth: false },
              { x: 400, y: 100, pointType: "onCurve", smooth: true },
              { x: 500, y: 100, pointType: "offCurve", smooth: false },
              { x: 600, y: 100, pointType: "offCurve", smooth: false },
              { x: 700, y: 100, pointType: "onCurve", smooth: false },
            ],
          },
        ],
      });
      await window.shift!.font.editCoordinator.settled();
      editor.selection.clear();
      editor.zoomToFit();
    });
    const canvas = page.locator("#interactive-canvas");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Expected editor canvas");
    const drag = await page.evaluate(() => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
      const cubic = layer.contours[0]!.segments()[0]!.asCubic()!;
      const down = editor.projectSceneToScreen({
        x: cubic.controlStart.x + node.position.x,
        y: cubic.controlStart.y + node.position.y,
      });
      const end = editor.projectSceneToScreen({
        x: 180 + node.position.x,
        y: 160 + node.position.y,
      });
      down.x = Math.round(down.x);
      down.y = Math.round(down.y);
      end.x = Math.round(end.x);
      end.y = Math.round(end.y);
      const startPos = editor.projectScreenToScene(down);
      const endPos = editor.projectScreenToScene(end);
      const length = Math.hypot(
        cubic.controlStart.x + endPos.x - startPos.x - cubic.start.x,
        cubic.controlStart.y + endPos.y - startPos.y - cubic.start.y,
      );
      return {
        id: cubic.controlStart.id,
        pivot: cubic.start.id,
        before: { x: cubic.controlStart.x, y: cubic.controlStart.y },
        down,
        end,
        expected: {
          x: cubic.start.x + length * Math.cos(Math.PI / 6),
          y: cubic.start.y + length * Math.sin(Math.PI / 6),
        },
      };
    });
    for (const point of [drag.down, drag.end]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.y).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(bounds.width);
      expect(point.y).toBeLessThan(bounds.height);
    }
    await canvas.click({ position: drag.down });
    await page.mouse.move(bounds.x + drag.down.x, bounds.y + drag.down.y);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    try {
      await page.mouse.move(bounds.x + drag.end.x, bounds.y + drag.end.y, { steps: 3 });
      await page.evaluate(() => window.shift!.editor.toolManager.flushPointerMoves());
      const preview = await pointPosition(page, drag.id);
      expect(preview.x).toBeCloseTo(drag.expected.x, 4);
      expect(preview.y).toBeCloseTo(drag.expected.y, 4);
      expect(await pointPosition(page, drag.pivot)).toEqual({ x: 100, y: 100 });
      if (releaseShiftFirst) await page.keyboard.up("Shift");
      await page.mouse.up();
      if (!releaseShiftFirst) await page.keyboard.up("Shift");
      await page.evaluate(async () => window.shift!.font.editCoordinator.settled());
      expect(await pointPosition(page, drag.id)).toEqual(preview);
      await expect(page.getByTestId("editor-shell")).toHaveAttribute("data-gesture", "idle");
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
