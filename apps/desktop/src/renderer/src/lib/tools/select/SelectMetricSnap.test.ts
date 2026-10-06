import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Select snaps dragged points to source metrics", () => {
  let editor: TestEditor;
  let xHeight: number;
  let top: number;
  let topLeftId: PointId;
  let topRightId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    const metrics = editor.font.metricsForSource(editor.requireGlyphLayer().sourceId);
    if (metrics.xHeight === undefined) throw new Error("Expected the test font to author x-height");
    xHeight = metrics.xHeight;
    top = xHeight - 40;

    const ids = await editor.drawOpenContour([
      { x: 300, y: 0 },
      { x: 300, y: top },
      { x: 500, y: top },
      { x: 500, y: 0 },
    ]);
    [, topLeftId, topRightId] = ids as [PointId, PointId, PointId, PointId];
    editor.selectTool("select");
  });

  it("snaps a lone point to a metric within the hit radius", async () => {
    const near = xHeight - editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 300, y: top },
      start: { x: 340, y: near },
      end: { x: 340, y: near },
    });

    expect(editor.pointPosition(topLeftId)).toEqual({ x: 340, y: xHeight });
    expect(editor.pointPosition(topRightId)).toEqual({ x: 500, y: top });
  });

  it("leaves a point free beyond the hit radius", async () => {
    const far = xHeight - editor.hitRadius * 2;

    await editor.dragLocal({
      down: { x: 300, y: top },
      start: { x: 340, y: far },
      end: { x: 340, y: far },
    });

    expect(editor.pointPosition(topLeftId)).toEqual({ x: 340, y: far });
  });

  it("lands both corners of a dragged edge on the metric", async () => {
    const lift = 40 - editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 400, y: top },
      start: { x: 400, y: top + lift },
      end: { x: 400, y: top + lift },
    });

    expect(editor.pointPosition(topLeftId)).toEqual({ x: 300, y: xHeight });
    expect(editor.pointPosition(topRightId)).toEqual({ x: 500, y: xHeight });
  });

  it("suspends snapping while Cmd is held", async () => {
    const near = xHeight - editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 300, y: top },
      start: { x: 340, y: near },
      end: { x: 340, y: near },
      options: { metaKey: true },
    });

    expect(editor.pointPosition(topLeftId)).toEqual({ x: 340, y: near });
  });

  it("snaps again once Cmd is released mid-drag", async () => {
    const near = xHeight - editor.hitRadius / 2;
    const down = editor.localToScreen({ x: 300, y: top });
    const away = editor.localToScreen({ x: 320, y: top + 10 });
    const target = editor.localToScreen({ x: 340, y: near });

    editor.pointerDown(down.x, down.y, { metaKey: true });
    editor.pointerMove(away.x, away.y, { metaKey: true });
    editor.pointerMove(target.x, target.y, { metaKey: true });
    editor.pointerMove(target.x, target.y);
    editor.pointerUp(target.x, target.y);
    await editor.settle();

    expect(editor.pointPosition(topLeftId)).toEqual({ x: 340, y: xHeight });
  });
});
