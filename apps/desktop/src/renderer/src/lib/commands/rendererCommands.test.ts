import { beforeEach, describe, expect, it } from "vitest";
import { mintContourId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { runRendererCommand } from "./rendererCommands";

describe("preview editor commands", () => {
  it("does not create canvas selection through Select All", async () => {
    const editor = new TestEditor("preview");
    await editor.startSession("preview", null);
    expect(await runRendererCommand(editor, "edit.selectAll")).toBe(false);
    expect(editor.selection.ids).toEqual([]);
  });
});

describe("Make First Point", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(400, 100);
    await editor.clickGlyphLocal(400, 400);
    await editor.clickGlyphLocal(100, 100);
    const layer = editor.requireGlyphLayer();
    expect(layer.upgradeLineToCubic(layer.contours[0].segments()[2].id)).toBe(true);
    await editor.settle();
    editor.selectTool("select");
  });

  it("rotates the closed point cycle, preserves curves and selection, and supports undo/redo", async () => {
    const before = editor.glyphContours[0];
    const pointId = before.points[1].id;
    editor.selection.select([pointId]);

    expect(await runRendererCommand(editor, "glyph.makeFirstPoint")).toBe(true);
    const after = editor.glyphContours[0];
    expect(after.closed).toBe(true);
    expect(after.points).toEqual([...before.points.slice(1), before.points[0]]);
    expect(editor.selection.ids).toEqual([pointId]);
    for (const segment of before.segments()) {
      const actual = after.segments().find((candidate) => candidate.id === segment.id);
      if (!actual) throw new Error("Expected original directed segment");

      expect(actual.type).toBe(segment.type);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(actual.pointAt(t)).toEqual(segment.pointAt(t));
      }
    }

    await editor.undo();
    expect(editor.glyphContours[0].points).toEqual(before.points);
    await editor.redo();
    expect(editor.glyphContours[0].points).toEqual(after.points);
  });

  it("does not promote handles, accept multiple points, or record an unchanged start", async () => {
    const before = editor.glyphContours[0];
    editor.selection.select([before.points[3].id]);
    expect(await runRendererCommand(editor, "glyph.makeFirstPoint")).toBe(false);
    editor.selection.select([before.points[1].id, before.points[2].id]);
    expect(await runRendererCommand(editor, "glyph.makeFirstPoint")).toBe(false);
    editor.selection.select([before.points[0].id]);
    expect(await runRendererCommand(editor, "glyph.makeFirstPoint")).toBe(false);
    editor.selection.clear();
    expect(await runRendererCommand(editor, "glyph.makeFirstPoint")).toBe(false);
    expect(editor.glyphContours[0].points).toEqual(before.points);

    await editor.undo();
    expect(editor.glyphContours[0].points).toEqual(before.points.slice(0, 3));
  });

  it("leaves an open contour's order unchanged", async () => {
    const layer = editor.requireGlyphLayer();
    layer.openContour(editor.glyphContours[0].id);
    await editor.settle();
    const before = editor.glyphContours[0].points;
    editor.selection.select([before[1].id]);

    expect(await runRendererCommand(editor, "glyph.makeFirstPoint")).toBe(false);
    expect(editor.glyphContours[0].closed).toBe(false);
    expect(editor.glyphContours[0].points).toEqual(before);
  });
});

describe("empty and invalid editor operations", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession("empty", null);
  });

  it("refuses clipboard mutations without selected content", async () => {
    expect(await editor.copy()).toBe(false);
    expect(await editor.cut()).toBe(false);
    expect(await editor.paste()).toBe(false);
    expect(editor.clipboardBuffer).toBe("");
    expect(editor.pointCount).toBe(0);
  });

  it("refuses deletion and duplication without selected geometry", async () => {
    expect(await editor.deleteSelection()).toBe(false);
    expect(await runRendererCommand(editor, "edit.duplicate")).toBe(false);
    expect(await runRendererCommand(editor, "edit.deselect")).toBe(false);
    expect(editor.pointCount).toBe(0);
  });

  it("refuses contour commands without a valid contour selection", async () => {
    expect(await runRendererCommand(editor, "glyph.reverseSelectedContour")).toBe(false);
    expect(editor.glyphContours).toEqual([]);
  });

  it("ignores boolean operations with missing contour identities", async () => {
    await editor.boolean(mintContourId(), mintContourId(), "union");
    expect(editor.glyphContours).toEqual([]);
  });

  it("duplicates selected geometry and selects the duplicate", async () => {
    await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    editor.selectAll();

    expect(await runRendererCommand(editor, "edit.duplicate")).toBe(true);
    expect(editor.pointCount).toBe(4);
    expect(editor.selection.ids).toHaveLength(2);
    expect(await runRendererCommand(editor, "edit.deselect")).toBe(true);
    expect(editor.selection.ids).toEqual([]);
  });

  it("routes native View commands through the canvas editor", async () => {
    const originalZoom = editor.zoom;

    expect(await runRendererCommand(editor, "view.zoomIn")).toBe(true);
    expect(editor.zoom).toBeGreaterThan(originalZoom);
    expect(await runRendererCommand(editor, "view.zoomOut")).toBe(true);
    expect(editor.zoom).toBeCloseTo(originalZoom);
  });

  it("routes native Edit commands through the canvas editor", async () => {
    await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const originalPointCount = editor.pointCount;

    expect(await runRendererCommand(editor, "edit.selectAll")).toBe(true);
    expect(editor.selection.ids).toHaveLength(originalPointCount);
    expect(await runRendererCommand(editor, "edit.copy")).toBe(true);
    expect(editor.clipboardBuffer).not.toBe("");

    expect(await runRendererCommand(editor, "edit.paste")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor, "edit.undo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount);
    expect(await runRendererCommand(editor, "edit.redo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor, "edit.deleteSelection")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount);
    expect(await runRendererCommand(editor, "edit.undo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor, "edit.selectAll")).toBe(true);
    expect(await runRendererCommand(editor, "edit.cut")).toBe(true);
    expect(editor.pointCount).toBe(0);
    expect(await runRendererCommand(editor, "edit.undo")).toBe(true);
    expect(editor.pointCount).toBe(originalPointCount * 2);
  });
});
