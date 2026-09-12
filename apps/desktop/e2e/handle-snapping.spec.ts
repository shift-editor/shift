import type { GlyphName } from "@shift/types";
import { workspaceTest as test, expect } from "./fixtures/electronApp";

for (const releaseShiftFirst of [true, false]) {
  test(`snaps a cubic handle every 15 degrees when Shift is released ${releaseShiftFirst ? "before" : "after"} mouseup`, async ({
    page,
    editor,
  }) => {
    const glyphId = await page.evaluate(async () => {
      const workspace = window.shift!;
      const record = workspace.editor.createGlyph("snapHandles" as GlyphName);
      await workspace.font.editCoordinator.settled();
      return record.id;
    });
    await editor.openGlyph(glyphId);
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
    const canvas = editor.canvas;
    const bounds = await editor.canvasBounds();
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
    await page.keyboard.down("Shift");
    await editor.pointerDown({ x: bounds.x + drag.down.x, y: bounds.y + drag.down.y });
    try {
      await editor.pointerMove({ x: bounds.x + drag.end.x, y: bounds.y + drag.end.y }, 3);
      const preview = await editor.livePointPosition(drag.id);
      expect(preview.x).toBeCloseTo(drag.expected.x, 4);
      expect(preview.y).toBeCloseTo(drag.expected.y, 4);
      expect(await editor.livePointPosition(drag.pivot)).toEqual({ x: 100, y: 100 });
      const guideScreen = await page.evaluate(() => {
        const editor = window.shift!.editor;
        const node = editor.scene.nodesOfKind("glyph")[0]!;
        const state = editor.toolIf("select")?.state;
        if (state?.type !== "translating") throw new Error("Expected Select translation");
        const guide = state.translate.guides[0];
        if (guide?.kind !== "direction") throw new Error("Expected direction guide");
        const from = editor.projectSceneToScreen({
          x: guide.from.x + node.position.x,
          y: guide.from.y + node.position.y,
        });
        const to = editor.projectSceneToScreen({
          x: guide.to.x + node.position.x,
          y: guide.to.y + node.position.y,
        });
        return [from, to, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }];
      });
      const redGuideVisible = () =>
        canvas.evaluate((element, positions) => {
          const surface = element as HTMLCanvasElement;
          const context = surface.getContext("2d");
          if (!context) throw new Error("Expected overlay context");
          const scale = surface.width / surface.clientWidth;
          return positions.every((point) => {
            const pixels = context.getImageData(
              Math.round(point.x * scale) - 3,
              Math.round(point.y * scale) - 3,
              7,
              7,
            ).data;
            for (let index = 0; index < pixels.length; index += 4) {
              if (
                pixels[index]! >= 240 &&
                pixels[index + 1]! >= 40 &&
                pixels[index + 1]! <= 90 &&
                pixels[index + 2]! <= 80 &&
                pixels[index + 3]! > 0
              ) {
                return true;
              }
            }
            return false;
          });
        }, guideScreen);
      await expect.poll(redGuideVisible).toBe(true);
      if (releaseShiftFirst) await page.keyboard.up("Shift");
      await editor.pointerUp();
      if (!releaseShiftFirst) await page.keyboard.up("Shift");
      expect(await editor.pointPosition(drag.id)).toEqual(preview);
      await expect(editor.shell).toHaveAttribute("data-gesture", "idle");
      await expect.poll(redGuideVisible).toBe(false);
      await editor.undo();
      await expect.poll(() => editor.pointPosition(drag.id)).toEqual(drag.before);
      await editor.redo();
      await expect.poll(() => editor.pointPosition(drag.id)).toEqual(preview);
    } finally {
      await page.mouse.up();
      await page.keyboard.up("Shift");
    }
  });
}
