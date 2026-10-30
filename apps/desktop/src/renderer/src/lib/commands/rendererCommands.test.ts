import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { useTestEditor } from "@/testing/fontFixture";
import type { OutlineContour, OutlinePoint } from "@/testing/reads";
import type { EditorTestSurface } from "@/testing/surface";
import { canMakeFirstPoint, runRendererCommand } from "./rendererCommands";

/** Clicks each glyph-local position in turn with the Pen. */
async function drawWithPen(
  editor: EditorTestSurface,
  points: readonly { x: number; y: number }[],
): Promise<void> {
  editor.selectTool("pen");
  for (const point of points) await editor.clickAt(point);
}

/** How many points, on- and off-curve, the open glyph has. */
async function pointCount(editor: EditorTestSurface): Promise<number> {
  const outline = await editor.outline();
  return outline.reduce((count, contour) => count + contour.points.length, 0);
}

/** The open glyph's first contour. */
async function firstContour(editor: EditorTestSurface): Promise<OutlineContour> {
  const [contour] = await editor.outline();
  if (!contour) throw new Error("Expected a contour");
  return contour;
}

/**
 * Each segment of a closed contour, keyed by the id of the on-curve point it
 * starts at: its points from there to the next on-curve point, both included.
 */
function segmentsByStart(contour: OutlineContour): Map<string, readonly OutlinePoint[]> {
  const { points } = contour;
  const segments = new Map<string, readonly OutlinePoint[]>();
  points.forEach((start, index) => {
    if (start.pointType !== "onCurve") return;
    const segment = [start];
    for (let step = 1; step <= points.length; step++) {
      const point = points[(index + step) % points.length]!;
      segment.push(point);
      if (point.pointType === "onCurve") break;
    }
    segments.set(start.id, segment);
  });
  return segments;
}

/** A segment's kind, from how many off-curve points it holds. */
function segmentType(segment: readonly OutlinePoint[] | undefined): string {
  const handles = (segment ?? []).filter((point) => point.pointType === "offCurve").length;
  return ["line", "quad", "cubic"][handles] ?? "unknown";
}

describe("preview editor commands", () => {
  const editor = useTestEditor({ mode: "preview" });

  it("does not create canvas selection through Select All", async () => {
    expect(await runRendererCommand(editor.asEditor(), "edit.selectAll")).toBe(false);
    expect(editor.selectionIds()).toEqual([]);
  });
});

describe("Make First Point", () => {
  const editor = useTestEditor();

  beforeEach(async () => {
    await drawWithPen(editor, [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 400 },
      { x: 100, y: 100 },
    ]);
    editor.selectTool("select");
    // Command-clicking the closing diagonal makes it a cubic.
    await editor.clickAt({ x: 250, y: 250 }, { metaKey: true });
    expect(await pointCount(editor)).toBe(5);
    editor.select([]);
  });

  it("rotates the closed point cycle, preserves curves and selection, and supports undo/redo", async () => {
    const before = await firstContour(editor);
    const pointId = before.points[1]!.id;
    editor.select([pointId]);

    expect(canMakeFirstPoint(editor.asEditor())).toBe(true);
    expect(await runRendererCommand(editor.asEditor(), "glyph.makeFirstPoint")).toBe(true);
    expect(canMakeFirstPoint(editor.asEditor())).toBe(false);
    const after = await firstContour(editor);
    expect(after.closed).toBe(true);
    expect(after.points).toEqual([...before.points.slice(1), before.points[0]]);
    expect(editor.selectionIds()).toEqual([pointId]);
    const afterSegments = segmentsByStart(after);
    for (const [start, segment] of segmentsByStart(before)) {
      const actual = afterSegments.get(start);
      if (!actual) throw new Error("Expected original directed segment");

      expect(segmentType(actual)).toBe(segmentType(segment));
      expect(actual).toEqual(segment);
    }

    await editor.undo();
    expect((await firstContour(editor)).points).toEqual(before.points);
    await editor.redo();
    expect((await firstContour(editor)).points).toEqual(after.points);
  });

  it("does not promote handles, accept multiple points, or record an unchanged start", async () => {
    const before = await firstContour(editor);
    const ids = before.points.map((point) => point.id as PointId);
    editor.select([ids[3]!]);
    expect(canMakeFirstPoint(editor.asEditor())).toBe(false);
    expect(await runRendererCommand(editor.asEditor(), "glyph.makeFirstPoint")).toBe(false);
    editor.select([ids[1]!, ids[2]!]);
    expect(canMakeFirstPoint(editor.asEditor())).toBe(false);
    expect(await runRendererCommand(editor.asEditor(), "glyph.makeFirstPoint")).toBe(false);
    editor.select([ids[0]!]);
    expect(canMakeFirstPoint(editor.asEditor())).toBe(false);
    expect(await runRendererCommand(editor.asEditor(), "glyph.makeFirstPoint")).toBe(false);
    editor.select([]);
    expect(canMakeFirstPoint(editor.asEditor())).toBe(false);
    expect(await runRendererCommand(editor.asEditor(), "glyph.makeFirstPoint")).toBe(false);
    expect((await firstContour(editor)).points).toEqual(before.points);

    await editor.undo();
    expect((await firstContour(editor)).points).toEqual(before.points.slice(0, 3));
  });

  it("leaves an open contour's order unchanged", async () => {
    const { middle } = await editor.draw({
      contours: [{ points: [[500, 100], { x: 600, y: 100, name: "middle" }, [600, 200]] }],
    });
    const [, open] = await editor.outline();
    if (!open) throw new Error("Expected the open contour");
    editor.select([middle]);

    expect(canMakeFirstPoint(editor.asEditor())).toBe(false);
    expect(await runRendererCommand(editor.asEditor(), "glyph.makeFirstPoint")).toBe(false);
    const [, after] = await editor.outline();
    expect(after?.closed).toBe(false);
    expect(after?.points).toEqual(open.points);
  });
});

describe("empty and invalid editor operations", () => {
  const editor = useTestEditor();

  it("refuses clipboard mutations without selected content", async () => {
    expect(await editor.copy()).toBe(false);
    expect(await editor.cut()).toBe(false);
    expect(await editor.paste()).toBe(false);
    expect(editor.clipboardText()).toBe("");
    expect(await pointCount(editor)).toBe(0);
  });

  it("refuses deletion and duplication without selected geometry", async () => {
    expect(await editor.deleteSelection()).toBe(false);
    expect(await runRendererCommand(editor.asEditor(), "edit.duplicate")).toBe(false);
    expect(await runRendererCommand(editor.asEditor(), "edit.deselect")).toBe(false);
    expect(await pointCount(editor)).toBe(0);
  });

  it("refuses contour commands without a valid contour selection", async () => {
    expect(await runRendererCommand(editor.asEditor(), "glyph.reverseSelectedContour")).toBe(false);
    expect(await editor.outline()).toEqual([]);
  });

  it("ignores boolean operations with missing contour identities", async () => {
    expect(await editor.combineSelectedContours("union")).toBe(false);
    expect(await editor.outline()).toEqual([]);
  });

  it("duplicates selected geometry and selects the duplicate", async () => {
    await drawWithPen(editor, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    editor.selectAll();
    const originalSelection = editor.selectionIds();

    expect(await runRendererCommand(editor.asEditor(), "edit.duplicate")).toBe(true);
    expect(await pointCount(editor)).toBe(4);
    const duplicateSelection = editor.selectionIds();
    expect(duplicateSelection).toHaveLength(2);

    await editor.undo();
    expect(await pointCount(editor)).toBe(2);
    expect(editor.selectionIds()).toEqual(originalSelection);
    await editor.redo();
    expect(await pointCount(editor)).toBe(4);
    expect(editor.selectionIds()).toEqual(duplicateSelection);

    expect(await runRendererCommand(editor.asEditor(), "edit.deselect")).toBe(true);
    expect(editor.selectionIds()).toEqual([]);
  });

  it("routes native View commands through the canvas editor", async () => {
    const originalZoom = editor.zoomLevel();

    expect(await runRendererCommand(editor.asEditor(), "view.zoomIn")).toBe(true);
    expect(editor.zoomLevel()).toBeGreaterThan(originalZoom);
    expect(await runRendererCommand(editor.asEditor(), "view.zoomOut")).toBe(true);
    expect(editor.zoomLevel()).toBeCloseTo(originalZoom);
  });

  it("routes native Edit commands through the canvas editor", async () => {
    await drawWithPen(editor, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const originalPointCount = await pointCount(editor);

    expect(await runRendererCommand(editor.asEditor(), "edit.selectAll")).toBe(true);
    expect(editor.selectionIds()).toHaveLength(originalPointCount);
    expect(await runRendererCommand(editor.asEditor(), "edit.copy")).toBe(true);
    expect(editor.clipboardText()).not.toBe("");

    expect(await runRendererCommand(editor.asEditor(), "edit.paste")).toBe(true);
    expect(await pointCount(editor)).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor.asEditor(), "edit.undo")).toBe(true);
    expect(await pointCount(editor)).toBe(originalPointCount);
    expect(await runRendererCommand(editor.asEditor(), "edit.redo")).toBe(true);
    expect(await pointCount(editor)).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor.asEditor(), "edit.deleteSelection")).toBe(true);
    expect(await pointCount(editor)).toBe(originalPointCount);
    expect(await runRendererCommand(editor.asEditor(), "edit.undo")).toBe(true);
    expect(await pointCount(editor)).toBe(originalPointCount * 2);

    expect(await runRendererCommand(editor.asEditor(), "edit.selectAll")).toBe(true);
    expect(await runRendererCommand(editor.asEditor(), "edit.cut")).toBe(true);
    expect(await pointCount(editor)).toBe(0);
    expect(await runRendererCommand(editor.asEditor(), "edit.undo")).toBe(true);
    expect(await pointCount(editor)).toBe(originalPointCount * 2);
  });
});
