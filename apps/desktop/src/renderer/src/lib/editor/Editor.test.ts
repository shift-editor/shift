import { describe, expect, it } from "vitest";
import type { ContourId } from "@shift/types";
import { line } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

describe("Editor scene bootstrap", () => {
  const editor = useTestEditor();

  it("places the opened glyph as the page run's child at the origin", () => {
    const glyph = editor.glyphNamed("A")!;
    const text = editor.canvasText();
    const [item] = text?.items ?? [];

    expect(text?.items).toHaveLength(1);
    expect(text?.glyphs).toMatchObject([{ glyphId: glyph.id, itemIds: [item?.id] }]);
    expect(text?.glyphs).toMatchObject([{ left: 0, baseline: 0, origin: { x: 0, y: 0 } }]);
    expect(text?.baselines).toEqual([0]);
    expect(editor.editorView().glyph).toMatchObject({
      glyphId: glyph.id,
      sourceId: editor.source("default")?.id,
    });
    expect(text?.openItemId).toBe(item?.id);
    expect(text?.editedItemId).toBe(item?.id);
  });

  it("resolves authored points and contours to their layer and the node showing it", async () => {
    const { start } = await editor.draw({
      contours: [line({ x: 100, y: 100, name: "start" }, [200, 100])],
    });
    const [contour] = await editor.outline();

    editor.select([start]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: 100, y: 100, width: 0, height: 0 });
    editor.selectObjects([contour!.id as ContourId]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: 100, y: 100, width: 100, height: 0 });
  });

  it("resolves authored points through the ownership index and keeps their bounds live", async () => {
    editor.selectTool("pen");
    await editor.clickAt({ x: 0, y: 0 });
    await editor.clickAt({ x: 100, y: 0 });
    await editor.clickAt({ x: 100, y: 100 });
    editor.selectTool("select");

    const [contour] = await editor.outline();
    const point = contour?.points[0];
    if (!point) throw new Error("Expected an authored point");

    editor.select([point.id]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: point.x });

    await editor.dragPoint(point.id, { x: 25, y: 0 });

    expect(editor.selectionLocalRect()).toMatchObject({ x: point.x + 25 });
    expect(await editor.point(point.id)).toMatchObject({ x: point.x + 25 });
  });

  it("materializes the opened glyph when selecting a sparse source", async () => {
    await editor.draw({ contours: [line([0, 0], [100, 0])] });
    const regular = editor.source("default")!;
    const defaultLayer = await editor.layerAt(regular.name);

    await editor.addGlyph("B", 66);
    await editor.openGlyph("B");
    await editor.addAxis(WEIGHT);
    await editor.addSource("Bold", { wght: 700 });
    editor.clickSource(regular.name);
    await editor.openGlyph("A");
    const bold = editor.source({ name: "Bold" })!;

    expect(editor.glyphNamed("A")?.layers.map(({ sourceId }) => sourceId)).not.toContain(bold.id);

    editor.clickSource("Bold");
    await editor.settle();

    const materializedLayer = await editor.layerAt("Bold");
    expect(editor.source("active")?.id).toBe(bold.id);
    expect(materializedLayer.contours[0]?.points.map(({ x, y }) => ({ x, y }))).toEqual(
      defaultLayer.contours[0]?.points.map(({ x, y }) => ({ x, y })),
    );
    expect(materializedLayer.contours[0]?.points.map((point) => point.id)).not.toEqual(
      defaultLayer.contours[0]?.points.map((point) => point.id),
    );
  });
});
