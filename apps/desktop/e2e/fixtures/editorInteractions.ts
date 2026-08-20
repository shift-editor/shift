import { expect, type Page } from "@playwright/test";

export interface EditablePointDrag {
  readonly id: string;
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly expected: { readonly x: number; readonly y: number };
}

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

export async function selectVisiblePoint(page: Page): Promise<EditablePointDrag> {
  const point = await page.evaluate(() => {
    const workspace = window.shift;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    const node = workspace?.editor.scene.nodesOfKind("glyph")[0];
    const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
    const layer = node ? glyph?.layerForSource(node.sourceId) : null;
    if (!workspace || !canvas || !node || !layer) throw new Error("Expected editable glyph");

    const bounds = canvas.getBoundingClientRect();
    const candidates = layer.allPoints
      .filter((candidate) => candidate.pointType === "onCurve")
      .map((candidate) => ({
        point: candidate,
        screen: workspace.editor.projectSceneToScreen({
          x: candidate.x + node.position.x,
          y: candidate.y + node.position.y,
        }),
      }))
      .filter(
        ({ screen }) =>
          screen.x >= 50 &&
          screen.y >= 50 &&
          screen.x <= bounds.width - 100 &&
          screen.y <= bounds.height - 100,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.screen.x - bounds.width / 2, a.screen.y - bounds.height / 2) -
          Math.hypot(b.screen.x - bounds.width / 2, b.screen.y - bounds.height / 2),
      );
    const candidate = candidates[0];
    if (!candidate) throw new Error("Expected visible on-curve point");

    const endScreen = { x: candidate.screen.x + 40, y: candidate.screen.y + 30 };
    const endScene = workspace.editor.projectScreenToScene(endScreen);
    return {
      id: candidate.point.id,
      start: { x: bounds.left + candidate.screen.x, y: bounds.top + candidate.screen.y },
      end: { x: bounds.left + endScreen.x, y: bounds.top + endScreen.y },
      expected: { x: endScene.x - node.position.x, y: endScene.y - node.position.y },
    };
  });

  await page.mouse.click(point.start.x, point.start.y);
  await expect
    .poll(() =>
      page.evaluate(
        (pointId) => window.shift?.editor.selection.ids.some((id) => id === pointId) ?? false,
        point.id,
      ),
    )
    .toBe(true);

  return point;
}

export async function hoverVisibleUnselectedPoint(page: Page): Promise<string> {
  const target = await page.evaluate(() => {
    const workspace = window.shift;
    const canvas = document.querySelector<HTMLCanvasElement>("#interactive-canvas");
    const node = workspace?.editor.scene.nodesOfKind("glyph")[0];
    const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
    const layer = node ? glyph?.layerForSource(node.sourceId) : null;
    if (!workspace || !canvas || !node || !layer) throw new Error("Expected editable glyph");

    const point = layer.allPoints.find(
      (candidate) =>
        candidate.pointType === "onCurve" && !workspace.editor.selection.has(candidate.id),
    );
    if (!point) throw new Error("Expected unselected point");

    const screen = workspace.editor.projectSceneToScreen({
      x: point.x + node.position.x,
      y: point.y + node.position.y,
    });
    const bounds = canvas.getBoundingClientRect();
    return { id: point.id, x: bounds.left + screen.x, y: bounds.top + screen.y };
  });

  await page.mouse.move(target.x, target.y);
  await expect.poll(() => page.evaluate(() => window.shift?.editor.hover.id)).toBe(target.id);
  return target.id;
}

export async function pointPosition(
  page: Page,
  pointId: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const workspace = window.shift;
    const node = workspace?.editor.scene.nodesOfKind("glyph")[0];
    const glyph = node ? workspace?.editor.glyphForId(node.glyphId) : null;
    const point = node
      ? glyph?.layerForSource(node.sourceId)?.allPoints.find((candidate) => candidate.id === id)
      : null;
    if (!point) throw new Error("Expected editable point");

    return { x: point.x, y: point.y };
  }, pointId);
}
