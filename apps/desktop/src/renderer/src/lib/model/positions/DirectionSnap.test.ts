import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import type { ContourId, GlyphName, PointId } from "@shift/types";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";
import {
  DirectionSnap,
  PositionReference,
  PositionTargets,
  type GlyphLayer,
} from "@shift/editor/model";

describe("direction snapping distinguishes the moving reference from its fixed pivot", () => {
  let stack: WorkspaceStack;
  let layer: GlyphLayer;
  let contourId: ContourId;
  let pointId: PointId;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.createWorkspace();
    layer = await addGlyph("A");
    const edit = layer.beginEdit();
    contourId = edit.addContour(false);
    const [added] = edit.addPoints(contourId, [Point.onCurve({ x: 100, y: 100 })]);
    if (!added) throw new Error("Expected a drawn point");
    edit.finish("Add point");
    await stack.editCoordinator.settled();
    pointId = added;
  });

  afterEach(() => stack.dispose());

  /** Creates the glyph `name` and returns its default source layer, loaded. */
  async function addGlyph(name: string): Promise<GlyphLayer> {
    const record = stack.font.createGlyph(name as GlyphName);
    await stack.editCoordinator.settled();
    const glyph = await stack.font.loadGlyph(record.id);
    const defaultLayer = glyph.layerForSource(stack.font.defaultSource.id);
    if (!defaultLayer) throw new Error(`Expected ${name}'s default source layer`);
    return defaultLayer;
  }

  it("preserves candidate distance from an explicit pivot and emits a pivot-based guide", () => {
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
    const append = layer.beginEdit();
    append.addPoints(contourId, [Point.onCurve({ x: 0, y: 100 })]);
    append.finish("Add point");
    await stack.editCoordinator.settled();
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
    const pivot = layer.addAnchor("top", { x: 0, y: 100 });
    await stack.editCoordinator.settled();
    const edit = layer.positions
      .move(new PositionTargets([pointId], [pivot]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(DirectionSnap.everyDegrees(90).around(PositionReference.anchor(pivot)));

    edit.preview({ x: 20, y: 50 });
    const feedback = edit.preview({ x: 20, y: 50 });
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    expect(layer.anchor(pivot)).toMatchObject({ x: 30, y: 100 });
    expect(feedback.guides).toEqual([
      { kind: "direction", from: { x: 0, y: 100 }, to: { x: 130, y: 100 } },
    ]);
    edit.discard();
    expect(layer.anchor(pivot)).toMatchObject({ x: 0, y: 100 });
  });

  it("uses the explicit moving reference rather than a target position", () => {
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
    const edit = layer.positions
      .move(PositionTargets.points([pointId]))
      .from(PositionReference.point(pointId))
      .directionSnappedBy(
        DirectionSnap.everyDegrees(90).around(PositionReference.position({ x: 0, y: 100 })),
      );

    edit.preview({ x: 20, y: 50 });
    edit.commit();
    await stack.editCoordinator.settled();
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
    await stack.editCoordinator.undo();
    await stack.editCoordinator.settled();
    expect(layer.point(pointId)).toMatchObject({ x: 100, y: 100 });
    await stack.editCoordinator.redo();
    await stack.editCoordinator.settled();
    expect(layer.point(pointId)).toMatchObject({ x: 130, y: 100 });
  });

  it("requires a moving reference before a pivoted preview without consuming configuration", () => {
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
    const other = await addGlyph("B");
    const edit = other.positions.move(PositionTargets.points([]));

    expect(() =>
      edit.directionSnappedBy(
        DirectionSnap.everyDegrees(90).around(PositionReference.point(pointId)),
      ),
    ).toThrow(/pivot does not exist in this glyph layer/);
    expect(other.allPoints).toEqual([]);
    edit.discard();
  });

  it("handles a candidate exactly on the pivot without invalid coordinates", () => {
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
