import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

function persistedGlyph(editor: TestEditor) {
  const glyphId = editor.glyphRecord?.id;
  const layer = editor.requireGlyphLayer();

  return {
    glyphId,
    layerId: layer.id,
    xAdvance: layer.xAdvance,
    contours: layer.contours.map((contour) => ({
      id: contour.id,
      closed: contour.closed,
      segments: contour.segments().map((segment) => segment.type),
      points: contour.points.map(({ id, pointType, smooth }) => ({ id, pointType, smooth })),
    })),
  };
}

function persistedPositions(editor: TestEditor) {
  return editor
    .requireGlyphLayer()
    .contours.flatMap((contour) => contour.points.map(({ x, y }) => ({ x, y })));
}

describe("saved editor outcomes survive a fresh workspace stack", () => {
  it("returns to clean when undo reaches the saved revision", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-saved-revision-"));
    const editor = new TestEditor();
    await editor.startSession();
    await editor.saveAs(join(outputRoot, "SavedRevision.shift"));

    editor.selectTool("pen");
    await editor.clickGlyphLocal(100, 100);
    await expect(editor.font.editCoordinator.state()).resolves.toMatchObject({ dirty: true });

    await editor.undo();
    await expect(editor.font.editCoordinator.state()).resolves.toMatchObject({ dirty: false });
    await editor.closeSession();
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it.each(["fit", "gap"] as const)(
    "persists %s deletion with exact geometry and identities",
    async (mode) => {
      const outputRoot = mkdtempSync(join(tmpdir(), "shift-deletion-reopen-"));
      const savePath = join(outputRoot, "Deleted.shift");
      const original = new TestEditor();
      await original.startSession();
      const points = await original.drawOpenContour([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 0 },
      ]);
      original.selection.select([points[1]]);
      await original.deleteSelection(mode);
      const expected = original.requireGlyphLayer().state;
      await original.saveAs(savePath);
      await original.closeSession();

      const reopened = new TestEditor();
      try {
        await reopened.openSession(savePath, "A");
        expect(reopened.requireGlyphLayer().state).toEqual(expected);
        expect(reopened.requireGlyphLayer().point(points[1])).toBeNull();
        await reopened.closeSession();
      } finally {
        rmSync(outputRoot, { recursive: true, force: true });
      }
    },
  );

  it("reopens authored geometry and continues undoable editing", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-fresh-reopen-"));
    const savePath = join(outputRoot, "RoundTrip.shift");
    const original = new TestEditor();
    await original.startSession();
    original.selectTool("pen");
    await original.clickGlyphLocal(100, 100);
    await original.clickGlyphLocal(300, 100);
    await original.dragScene({
      down: { x: 500, y: 100 },
      start: { x: 504, y: 104 },
      end: { x: 580, y: 180 },
    });
    await original.dragScene({
      down: { x: 700, y: 100 },
      start: { x: 704, y: 104 },
      end: { x: 780, y: 180 },
    });
    original.setXAdvance(700);
    await expect(original.font.editCoordinator.state()).resolves.toMatchObject({
      dirty: true,
      needsSaveAs: true,
    });
    await expect(original.saveAs(savePath)).resolves.toMatchObject({
      dirty: false,
      needsSaveAs: false,
    });

    const firstPoint = original.requireGlyphLayer().allPoints[0];
    if (!firstPoint) throw new Error("Expected authored point");
    original.selectTool("select");
    await original.dragScene({
      down: firstPoint,
      start: { x: firstPoint.x + 4, y: firstPoint.y },
      end: { x: firstPoint.x + 40, y: firstPoint.y + 30 },
    });
    original.setXAdvance(720);
    await expect(original.font.editCoordinator.state()).resolves.toMatchObject({ dirty: true });
    await expect(original.save()).resolves.toMatchObject({ dirty: false });
    const expected = persistedGlyph(original);
    const expectedPositions = persistedPositions(original);
    expect(expected.contours[0]).toMatchObject({
      closed: false,
      segments: ["line", "cubic", "cubic"],
    });
    expect(expected.contours[0]?.points.some((point) => point.smooth)).toBe(true);
    await original.closeSession();

    const reopened = new TestEditor();
    await reopened.openSession(savePath, "A");
    await expect(reopened.font.editCoordinator.state()).resolves.toMatchObject({
      dirty: false,
      needsSaveAs: false,
    });
    expect(persistedGlyph(reopened)).toEqual(expected);
    const reopenedPositions = persistedPositions(reopened);
    for (const [index, position] of reopenedPositions.entries()) {
      expect(position.x).toBeCloseTo(expectedPositions[index]!.x);
      expect(position.y).toBeCloseTo(expectedPositions[index]!.y);
    }

    const reopenedPoint = reopened.requireGlyphLayer().allPoints[0];
    if (!reopenedPoint) throw new Error("Expected reopened point");
    const savedPosition = reopened.pointPosition(reopenedPoint.id);
    reopened.selectTool("select");
    const drag = await reopened.dragScene({
      down: savedPosition,
      start: { x: savedPosition.x + 4, y: savedPosition.y },
      end: { x: savedPosition.x + 30, y: savedPosition.y + 20 },
    });
    const editedPosition = reopened.pointPosition(reopenedPoint.id);
    expect(editedPosition).toEqual({
      x: savedPosition.x + drag.delta.x,
      y: savedPosition.y + drag.delta.y,
    });

    await reopened.undo();
    expect(reopened.pointPosition(reopenedPoint.id)).toEqual(savedPosition);
    await reopened.redo();
    expect(reopened.pointPosition(reopenedPoint.id)).toEqual(editedPosition);
    await reopened.save();
    await reopened.closeSession();
    rmSync(outputRoot, { recursive: true, force: true });
  });
});
