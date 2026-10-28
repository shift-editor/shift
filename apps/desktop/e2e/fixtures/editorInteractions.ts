import type { Page } from "@playwright/test";
import type { LocalPoint } from "@shift/editor/spaces";
import type { Point2D } from "@shift/geo";

export async function addSquare(page: Page): Promise<number> {
  return page.evaluate(async () => {
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
}

/**
 * A page position where the canvas hit-tests the selected component, searched on a grid
 * inside its bounds; throws when no component is selected or none of the grid hits it.
 */
export async function selectedComponentHitPoint(page: Page): Promise<Point2D> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const [componentId] = editor.selection.ids;
    const object = componentId ? editor.object(componentId) : null;
    const bounds = object?.kind === "component" ? object.bounds() : null;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    if (!componentId || !object || !bounds || !canvas) {
      throw new Error("Expected selected component bounds");
    }

    const canvasBounds = canvas.getBoundingClientRect();
    for (let row = 1; row < 20; row += 1) {
      for (let column = 1; column < 20; column += 1) {
        const local = {
          x: bounds.min.x + ((bounds.max.x - bounds.min.x) * column) / 20,
          y: bounds.min.y + ((bounds.max.y - bounds.min.y) * row) / 20,
        };
        const scene = editor.toScene(object.node, local as LocalPoint);
        const target = editor.getPointerTarget(scene);
        if (target.kind !== "component" || target.id !== componentId) continue;

        const screen = editor.sceneToScreen(scene);
        return { x: canvasBounds.left + screen.x, y: canvasBounds.top + screen.y };
      }
    }

    throw new Error("Expected a hittable component position");
  });
}

/**
 * Canvas-local positions on the open glyph as the canvas draws it now, interpolated where the
 * location is between sources: its first point, the middle of its first segment, and empty
 * canvas 15px below the glyph's descender at half its advance.
 */
export async function glyphClickTargets(page: Page): Promise<Point2D[]> {
  return page.evaluate(() => {
    const editor = window.shiftSession!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
    const glyph = editor.glyphForId(node.glyphId)!;
    const geometry = glyph.geometryAt(editor.externalLocation);
    const point = geometry.allPoints[0]!;
    const segment = geometry.segments[0]!.pointAt(0.5);
    const view = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    const metrics = editor.font.metricsAtLocation(editor.externalLocation);
    return [
      point,
      segment,
      {
        x: view.xAdvanceCell.peek() / 2,
        y: metrics.descender - editor.camera.screenToSceneDistance(15),
      },
    ].map((point) => editor.sceneToScreen(editor.toScene(node, point as LocalPoint)));
  });
}
