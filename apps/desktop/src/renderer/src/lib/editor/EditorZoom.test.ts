import { beforeEach, describe, expect, it } from "vitest";
import { Bounds, type Rect2D } from "@shift/geo";
import { scenePoint } from "@shift/editor/spaces";
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
      await editor.clickLocal(point.x, point.y);
    }
    editor.escape();
  });

  it("centres all scene content when zooming to fit", () => {
    const nodeBounds = editor.scene.nodes().flatMap((node) => editor.nodeBounds(node) ?? []);
    const bounds = nodeBounds.reduce<Bounds>(
      (union, next) => Bounds.union(union, next),
      nodeBounds[0]!,
    );
    const centre = Bounds.center(bounds);

    editor.setZoom(0.25);
    editor.zoomToFit();

    expect(editor.sceneToScreen(scenePoint(centre.x, centre.y))).toEqual(editor.camera.centre);
    expect(editor.zoom).toBeGreaterThan(0.25);
  });

  it("centres the selected content when zooming to selection", () => {
    editor.selectAll();
    const bounds = editor.selectionBounds();
    if (!bounds) throw new Error("Expected selection bounds");

    editor.setZoom(0.25);
    editor.zoomToSelection();

    expect(editor.localToScreen(Bounds.center(bounds))).toEqual(editor.camera.centre);
  });

  it("sets an absolute zoom level around the viewport centre", () => {
    const sceneCentre = editor.screenToScene(editor.camera.centre);

    editor.setZoom(2);

    expect(editor.zoom).toBe(2);
    expect(editor.sceneToScreen(sceneCentre)).toEqual(editor.camera.centre);
  });
});

describe("opening a glyph frames its UPM box in the viewport", () => {
  const viewport = { width: 800, height: 560 };
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.setCameraRect(viewport as Rect2D);
  });

  it.each([null, 20, 1200, 5000])(
    "keeps origin, advance, and vertical metrics visible for outline width %s",
    async (width) => {
      const layer = editor.requireGlyphLayer();
      layer.setXAdvance(width ?? 500);
      if (width !== null) {
        const contourId = layer.addContour();
        for (const [x, y] of [
          [0, -100],
          [width, -100],
          [width, 900],
          [0, 900],
        ] as const) {
          layer.addPoint(contourId, { x, y, pointType: "onCurve", smooth: false });
        }
        layer.closeContour(contourId);
      }
      await editor.settle();

      editor.fitGlyphFrame(editor.glyphNode!);

      const { ascender, descender } = editor.font.metricsAtLocation(editor.externalLocation);
      const corners = [
        { x: 0, y: ascender },
        { x: editor.xAdvance, y: descender },
      ].map((point) => editor.localToScreen(point));
      for (const corner of corners) {
        expect(corner.x).toBeGreaterThanOrEqual(0);
        expect(corner.x).toBeLessThanOrEqual(viewport.width);
        expect(corner.y).toBeGreaterThanOrEqual(0);
        expect(corner.y).toBeLessThanOrEqual(viewport.height);
      }
    },
  );
});
