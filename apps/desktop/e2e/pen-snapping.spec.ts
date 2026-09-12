import type { GlyphName } from "@shift/types";
import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { openGlyphRoute } from "./fixtures/appLocators";

for (const releaseShiftFirst of [true, false]) {
  test(`snaps Pen creation handles when Shift is released ${releaseShiftFirst ? "before" : "after"} mouseup`, async ({
    page,
  }) => {
    const glyphId = await page.evaluate(async () => {
      const workspace = window.shift!;
      const record = workspace.editor.createGlyph("snapPen" as GlyphName);
      await workspace.font.editCoordinator.settled();
      return record.id;
    });
    await openGlyphRoute(page, glyphId);
    const canvas = page.locator("#interactive-canvas");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Expected canvas");
    const first = { x: Math.round(bounds.width / 4), y: Math.round(bounds.height / 2) };
    const down = { x: Math.round(bounds.width / 2), y: first.y };
    const end = { x: down.x + 80, y: down.y - 60 };
    for (const point of [first, down, end]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.y).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(bounds.width);
      expect(point.y).toBeLessThan(bounds.height);
    }
    await page.keyboard.press("p");
    await canvas.click({ position: first });
    await page.evaluate(async () => window.shift!.font.editCoordinator.settled());
    const expected = await page.evaluate(
      ({ down, end }) => {
        const editor = window.shift!.editor;
        const node = editor.scene.nodesOfKind("glyph")[0]!;
        const anchor = editor.projectScreenToScene(down);
        const pointer = editor.projectScreenToScene(end);
        const length = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
        anchor.x -= node.position.x;
        anchor.y -= node.position.y;
        return {
          anchor,
          incoming: {
            x: anchor.x - length * Math.cos(Math.PI / 6),
            y: anchor.y - length * Math.sin(Math.PI / 6),
          },
          outgoing: {
            x: anchor.x + length * Math.cos(Math.PI / 6),
            y: anchor.y + length * Math.sin(Math.PI / 6),
          },
        };
      },
      { down, end },
    );
    const points = () =>
      page.evaluate(() => {
        const editor = window.shift!.editor;
        const node = editor.scene.nodesOfKind("glyph")[0]!;
        const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
        return layer.allPoints.map((point) => ({ id: point.id, x: point.x, y: point.y }));
      });
    expect(await points()).toHaveLength(1);
    await page.mouse.move(bounds.x + down.x, bounds.y + down.y);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    try {
      await page.mouse.move(bounds.x + end.x, bounds.y + end.y);
      await page.evaluate(() => window.shift!.editor.toolManager.flushPointerMoves());
      const preview = await points();
      expect(preview).toHaveLength(4);
      expect(preview[2]!.x).toBeCloseTo(expected.incoming.x, 4);
      expect(preview[2]!.y).toBeCloseTo(expected.incoming.y, 4);
      expect(preview[3]!.x).toBeCloseTo(expected.anchor.x, 4);
      expect(preview[3]!.y).toBeCloseTo(expected.anchor.y, 4);
      const handle = await page.evaluate(() => {
        const state = window.shift!.editor.toolIf("pen")?.state;
        if (state?.type !== "dragging") throw new Error("Expected Pen drag");
        return state.curve.handlePosition;
      });
      expect(handle.x).toBeCloseTo(expected.outgoing.x, 4);
      expect(handle.y).toBeCloseTo(expected.outgoing.y, 4);
      if (releaseShiftFirst) await page.keyboard.up("Shift");
      await page.mouse.up();
      if (!releaseShiftFirst) await page.keyboard.up("Shift");
      await page.evaluate(async () => window.shift!.font.editCoordinator.settled());
      expect(await points()).toEqual(preview);
      await expect(page.getByTestId("editor-shell")).toHaveAttribute("data-gesture", "idle");
      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(points).toHaveLength(1);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(points).toEqual(preview);
    } finally {
      await page.mouse.up();
      await page.keyboard.up("Shift");
    }
  });
}
