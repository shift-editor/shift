import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { DirectionSnap, PositionReference, PositionTargets } from "@shift/editor/model";

describe("direction snapping distinguishes the moving reference from its fixed pivot", () => {
  let editor: TestEditor;
  let pointId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickLocal(100, 100);
    pointId = editor.requireGlyphLayer().allPoints[0]!.id;
  });

  it("preserves candidate distance from an explicit pivot and emits a pivot-based guide", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(45).around(PositionReference.position({ x: 0, y: 100 })),
      );

    const feedback = edit.preview({ x: -20, y: 60 });
    const component = 100 / Math.sqrt(2);
    const moved = layer.point(pointId)!;
    expect(moved.x).toBeCloseTo(component);
    expect(moved.y).toBeCloseTo(100 + component);
    expect(feedback.delta.x).toBeCloseTo(component - 100);
    expect(feedback.delta.y).toBeCloseTo(component);
    expect(feedback.guides).toEqual([
      { kind: "direction", from: { x: 0, y: 100 }, to: { x: moved.x, y: moved.y } },
    ]);
    edit.discard();
    expect(layer.point(pointId)).toMatchObject({ x: 100, y: 100 });
  });

  it("keeps a point pivot frozen even when it is also a movement target", async () => {
    await editor.clickLocal(0, 100);
    const layer = editor.requireGlyphLayer();
    const pivot = layer.allPoints[1]!.id;
    const edit = layer.positions
      .move(PositionTargets.points([pointId, pivot]))
      .directionSnappedBy(DirectionSnap.everyDegrees(90).around(PositionReference.point(pivot)))
      .from(PositionReference.point(pointId));

    edit.preview({ x: 20, y: 50 });
    edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    expect(layer.point(pivot)).toMatchObject({ x: 30, y: 100 });
    edit.discard();
    expect(layer.point(pointId)).toMatchObject({ x: 100, y: 100 });
    expect(layer.point(pivot)).toMatchObject({ x: 0, y: 100 });
  });

  it("resolves an anchor pivot and applies the same correction to point and anchor targets", async () => {
    const layer = editor.requireGlyphLayer();
    const pivot = layer.addAnchor("top", { x: 0, y: 100 });
    await editor.settle();
    const edit = layer.positions
      .move(new PositionTargets([pointId], [pivot]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(DirectionSnap.everyDegrees(90).around(PositionReference.anchor(pivot)));

    edit.preview({ x: 20, y: 50 });
    const feedback = edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    expect(editor.requireGlyphLayer().anchor(pivot)).toMatchObject({ x: 30, y: 100 });
    expect(feedback.guides).toEqual([
      { kind: "direction", from: { x: 0, y: 100 }, to: { x: 130, y: 100 } },
    ]);
    edit.discard();
    expect(editor.requireGlyphLayer().anchor(pivot)).toMatchObject({ x: 0, y: 100 });
  });

  it("uses the explicit moving reference rather than a target position", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.position({ x: 100, y: 200 }))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(90).around(PositionReference.position({ x: 0, y: 200 })),
      );

    const feedback = edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    expect(feedback.guides).toEqual([
      { kind: "direction", from: { x: 0, y: 200 }, to: { x: 130, y: 200 } },
    ]);
    edit.discard();
  });

  it("allows a caller to suppress guides without disabling direction snapping", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(90)
          .around(PositionReference.position({ x: 0, y: 100 }))
          .withoutGuides(),
      );

    const feedback = edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    expect(feedback.guides).toEqual([]);
    edit.discard();
  });

  it("reevaluates activation without accumulating snapped previews", () => {
    const layer = editor.requireGlyphLayer();
    let enabled = true;
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(90, { when: () => enabled }).around(
          PositionReference.position({ x: 0, y: 100 }),
        ),
      );

    edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    enabled = false;
    expect(edit.preview({ x: 20, y: 50 }).guides).toEqual([]);
    expect(layer.point(pointId)).toMatchObject({ x: 120, y: 150 });
    enabled = true;
    edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    edit.discard();
  });

  it("commits the snapped position through the workspace with undo and redo", async () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(90).around(PositionReference.position({ x: 0, y: 100 })),
      );

    edit.preview({ x: 20, y: 50 });
    edit.commit();
    await editor.settle();
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    await editor.undo();
    expect(layer.point(pointId)).toMatchObject({ x: 100, y: 100 });
    await editor.redo();
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
  });

  it("requires a moving reference before a pivoted preview without consuming configuration", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(90).around(PositionReference.position({ x: 0, y: 100 })),
      );

    expect(() => edit.preview({ x: 20, y: 50 })).toThrow(/MoveEdit.from/);
    expect(layer.point(pointId)).toMatchObject({ x: 100, y: 100 });
    edit.from(PositionReference.point(pointId));
    edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    edit.discard();
  });

  it("rejects a pivot belonging to a different authored layer", async () => {
    await editor.addGlyph("B", 66);
    const layer = editor
      .glyphForId(editor.font.recordForName("B")!.id)!
      .layerForSource(editor.font.defaultSource.id)!;
    const edit = layer.positions.move(PositionTargets.points([]));

    expect(() =>
      edit.directionSnappedBy(
        DirectionSnap.everyDegrees(90).around(PositionReference.point(pointId)),
      ),
    ).toThrow(/pivot does not exist in this glyph layer/);
    expect(layer.allPoints).toEqual([]);
    edit.discard();
  });

  it("handles a candidate exactly on the pivot without invalid coordinates", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(45).around(PositionReference.position({ x: 0, y: 100 })),
      );

    const feedback = edit.preview({ x: -100, y: 0 });
    expect(layer.point(pointId)).toMatchObject({ x: 0, y: 100 });
    expect(feedback.delta).toEqual({ x: -100, y: 0 });
    edit.discard();
  });

  it("keeps the attached pivot when the snap configuration is subsequently changed", () => {
    const layer = editor.requireGlyphLayer();
    const snap = DirectionSnap.everyDegrees(90).around(
      PositionReference.position({ x: 0, y: 100 }),
    );
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(snap);

    snap.around(PositionReference.position({ x: 100, y: 0 }));
    edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    edit.discard();
  });

  it("does not expose the frozen pivot through returned guides", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(45).around(PositionReference.position({ x: 0, y: 100 })),
      );

    const feedback = edit.preview({ x: 0, y: 100 });
    const guide = feedback.guides[0];
    if (guide?.kind !== "direction") throw new Error("Expected direction guide");
    guide.from.x = 100;
    const nextGuide = edit.preview({ x: 0, y: 100 }).guides[0];
    if (nextGuide?.kind !== "direction") throw new Error("Expected direction guide");
    expect(nextGuide.from).toEqual({ x: 0, y: 100 });
    expect(nextGuide.to.x).toBeCloseTo(100);
    expect(nextGuide.to.y).toBeCloseTo(200);
    expect(layer.point(pointId)!.x).toBeCloseTo(100);
    expect(layer.point(pointId)!.y).toBeCloseTo(200);
    edit.discard();
  });

  it("retains delta-based snapping without a pivot or moving reference", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .directionSnappedBy(DirectionSnap.everyDegrees(90));

    const feedback = edit.preview({ x: 120, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 230, y: 100 });
    expect(feedback.delta).toEqual({ x: 130, y: 0 });
    expect(feedback.guides).toEqual([]);
    edit.discard();
  });
});
