import { beforeEach, describe, expect, it } from "vitest";
import { Curve } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { GlyphLayer } from "@shift/editor/model";
import { TestEditor } from "@/testing/TestEditor";

describe("glyph layer geometry follows coordinate patches", () => {
  let editor: TestEditor;
  let layer: GlyphLayer;
  let first: PointId;
  let second: PointId;

  // An open contour from (10, 20) to (30, 40) in a glyph that advances 500.
  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [first, second] = await editor.drawOpenContour([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
    layer = editor.requireGlyphLayer();
    editor.selectTool("select");
  });

  /** Holds a Select drag of the second point to (75, 125) without releasing it. */
  const previewSecondPointMove = () =>
    editor.holdDragLocal({
      down: { x: 30, y: 40 },
      start: { x: 34, y: 40 },
      end: { x: 75, y: 125 },
    });

  const position = (pointId: PointId) => {
    const source = layer.positionsFor([{ kind: "point", id: pointId }])[0];
    const point = layer.point(pointId);
    return {
      source: source && { x: source.x, y: source.y },
      geometry: point && { x: point.x, y: point.y },
    };
  };

  it("keeps layer positions and geometry lookup in sync while a drag previews", () => {
    previewSecondPointMove();

    expect(position(second)).toEqual({
      source: { x: 75, y: 125 },
      geometry: { x: 75, y: 125 },
    });
  });

  it("invalidates geometry that was read before a drag previews", () => {
    expect(layer.point(second)).toMatchObject({ x: 30, y: 40 });

    previewSecondPointMove();

    expect(position(second)).toEqual({
      source: { x: 75, y: 125 },
      geometry: { x: 75, y: 125 },
    });
  });

  it("keeps contour points and all-points geometry fresh while a drag previews", () => {
    expect(layer.contours[0]?.points[1]).toMatchObject({ id: second, x: 30, y: 40 });

    previewSecondPointMove();

    expect(layer.contours[0]?.points[1]).toMatchObject({ id: second, x: 75, y: 125 });
    expect(layer.allPoints.find((point) => point.id === second)).toMatchObject({ x: 75, y: 125 });
  });

  it("keeps anchor positions and geometry lookup in sync while an anchor drag previews", () => {
    editor.addAnchorAt({ x: 300, y: 400 });
    const anchorId = layer.anchors[0]!.id;

    editor.holdDragLocal({
      down: { x: 300, y: 400 },
      start: { x: 304, y: 400 },
      end: { x: 330, y: 440 },
    });

    expect(layer.positionsFor([{ kind: "anchor", id: anchorId }])[0]).toMatchObject({
      x: 330,
      y: 440,
    });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 330, y: 440 });
  });

  it("updates bounds and sidebearings derived from point coordinates", async () => {
    await editor.dragLocal({
      down: { x: 10, y: 20 },
      start: { x: 6, y: 20 },
      end: { x: -25, y: 20 },
    });
    await editor.dragLocal({
      down: { x: 30, y: 40 },
      start: { x: 34, y: 40 },
      end: { x: 75, y: 125 },
    });

    expect([editor.pointPosition(first), editor.pointPosition(second)]).toEqual([
      { x: -25, y: 20 },
      { x: 75, y: 125 },
    ]);
    expect(layer.bounds).toEqual({ min: { x: -25, y: 20 }, max: { x: 75, y: 125 } });
    expect(layer.sidebearings).toEqual({ lsb: -25, rsb: 425 });
  });

  it("measures sidebearings from a curve's tight bounds, not its control points", async () => {
    const contourId = layer.addContour();
    layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
    layer.addCubic(
      contourId,
      Curve.cubic({ x: 0, y: 0 }, { x: -100, y: 100 }, { x: -100, y: 100 }, { x: 200, y: 0 }),
    );
    await editor.settle();

    // The curve's leftmost extreme, at t = (√3 − 1) / 2, lies well inside its controls at x = −100.
    expect(layer.bounds?.min.x).toBeCloseTo(-59.81, 1);
    expect(layer.sidebearings.lsb).toBeCloseTo(-59.81, 1);
    expect(layer.sidebearings.rsb).toBe(300);
  });

  it("reports the new advance and right sidebearing after an advance change", async () => {
    expect(layer.xAdvance).toBe(500);
    expect(layer.sidebearings).toEqual({ lsb: 10, rsb: 470 });

    layer.setXAdvance(650);
    await editor.settle();

    expect(layer.xAdvance).toBe(650);
    expect(layer.sidebearings).toEqual({ lsb: 10, rsb: 620 });
  });

  it("tells a renderer tracking positions when the advance changes", async () => {
    const advances = editor.watchLayer(layer, "positions", (watched) => watched.xAdvance);

    layer.setXAdvance(650);
    await editor.settle();
    advances.stop();

    expect(advances.values).toEqual([500, 650]);
  });
});
