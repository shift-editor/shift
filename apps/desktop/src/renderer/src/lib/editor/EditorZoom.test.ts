import { beforeEach, describe, expect, it } from "vitest";
import { Bounds, type Rect2D } from "@shift/geo";
import { TestEditor } from "@/testing";

describe("viewport zoom actions", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.setCameraRect({ width: 1000, height: 800 } as Rect2D);
    editor.selectTool("pen");
    for (const point of [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ]) {
      await editor.clickGlyphLocal(point.x, point.y);
    }
    editor.escape();
  });

  it("centres all scene content when zooming to fit", () => {
    const bounds = editor.sceneGlyphRenderModel?.bounds;
    if (!bounds) throw new Error("Expected glyph bounds");

    editor.setZoom(0.25);
    editor.zoomToFit();

    expect(editor.projectSceneToScreen(Bounds.center(bounds))).toEqual(editor.camera.centre);
    expect(editor.zoom).toBeGreaterThan(0.25);
  });

  it("centres the selected content when zooming to selection", () => {
    editor.selectAll();
    const bounds = editor.selectionBounds();
    if (!bounds) throw new Error("Expected selection bounds");

    editor.setZoom(0.25);
    editor.zoomToSelection();

    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    expect(editor.projectSceneToScreen(centre)).toEqual(editor.camera.centre);
  });

  it("sets an absolute zoom level around the viewport centre", () => {
    const sceneCentre = editor.projectScreenToScene(editor.camera.centre);

    editor.setZoom(2);

    expect(editor.zoom).toBe(2);
    expect(editor.projectSceneToScreen(sceneCentre)).toEqual(editor.camera.centre);
  });
});
