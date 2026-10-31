import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnchorId, AxisId, PointId, SourceId } from "@shift/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import { PositionEdits, PositionTargets, type GlyphLayer } from "@shift/editor/model";
import type { PositionSelection } from "@shift/editor/types";
import { WEIGHT, useTestEditor } from "@/testing/fontFixture";
import type { GlyphFixture } from "@/testing/fixtures";
import { drawPoints, startWorkspaceGlyph, type WorkspaceStack } from "@/testing/workspaceStack";

// Position edits over a selection that spans matched layers in two sources, on the real
// workspace stack: the selection is assembled from the engine's layer match, as the editor's
// multi-source editing assembles it.
describe("multi-source position edits", () => {
  let stack: WorkspaceStack;
  let layer: GlyphLayer;
  let targetLayer: GlyphLayer;
  let anchorId: AnchorId;
  let firstId: PointId;
  let lastId: PointId;
  let targetFirstId: PointId;
  let targetLastId: PointId;

  beforeEach(async () => {
    const started = await startWorkspaceGlyph();
    ({ stack, layer } = started);
    const { record, glyph } = started;
    const [first, , last] = drawPoints(layer, [
      { x: 100, y: 100 },
      { x: 150, y: 150 },
      { x: 200, y: 200 },
    ]).pointIds;
    if (!first || !last) throw new Error("Expected drawn points");
    [firstId, lastId] = [first, last];
    anchorId = layer.addAnchor("top", { x: 150, y: 250 });
    await stack.editCoordinator.settled();

    const axisId: AxisId = stack.font.createAxis(weightAxis());
    await stack.editCoordinator.settled();
    const boldId: SourceId = stack.font.createSource(
      "Bold",
      externalAxisLocationFromRecord({ [axisId]: 700 }),
    );
    await stack.editCoordinator.settled();
    stack.font.cloneGlyphLayer(record.id, boldId, layer.id);
    await stack.editCoordinator.settled();
    targetLayer = requireLayer(glyph.layerForSource(boldId));

    const selection = await positionSelection(new PositionTargets([firstId, lastId], []));
    const [firstTarget, lastTarget] = selection.additionalLayers[0]!.targets.points;
    if (!firstTarget || !lastTarget) throw new Error("Expected matched target points");
    targetFirstId = firstTarget;
    targetLastId = lastTarget;
  });

  afterEach(() => stack.dispose());

  /** `targets` in the default source with their counterparts in Bold, as the engine matches the two layers. */
  async function positionSelection(targets: PositionTargets): Promise<PositionSelection> {
    const match = await stack.font.matchLayers(layer.id, targetLayer.id);
    if (!match.complete) throw new Error("Expected the Bold layer to match completely");
    const points = new Map(
      match.points.map(({ referenceId, targetId }) => [referenceId, targetId]),
    );
    const anchors = new Map(
      match.anchors.map(({ referenceId, targetId }) => [referenceId, targetId]),
    );
    const counterpart = <Id>(ids: ReadonlyMap<Id, Id>, id: Id): Id => {
      const target = ids.get(id);
      if (!target) throw new Error("Expected a matched counterpart");
      return target;
    };
    return {
      layer,
      targets,
      additionalLayers: [
        {
          layer: targetLayer,
          targets: new PositionTargets(
            targets.points.map((id) => counterpart(points, id)),
            targets.anchors.map((id) => counterpart(anchors, id)),
          ),
        },
      ],
    };
  }

  it("moves matched anchors and discards every source preview", async () => {
    const selection = await positionSelection(new PositionTargets([], [anchorId]));
    const targetSelection = selection.additionalLayers[0];
    const targetAnchorId = targetSelection?.targets.anchors[0];
    if (!targetSelection || !targetAnchorId) throw new Error("Expected matched target anchor");
    const move = PositionEdits.fromSelection(selection).move(selection.targets);

    move.preview({ x: 20, y: -10 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 170, y: 240 });
    expect(targetSelection.layer.anchor(targetAnchorId)).toMatchObject({ x: 170, y: 240 });

    move.discard();
    expect(layer.anchor(anchorId)).toMatchObject({ x: 150, y: 250 });
    expect(targetSelection.layer.anchor(targetAnchorId)).toMatchObject({ x: 150, y: 250 });
  });

  it("scales each source around its corresponding pivot and undoes both atomically", async () => {
    const targetOffset = targetLayer.positions.move(
      PositionTargets.points([targetFirstId, targetLastId]),
    );
    targetOffset.preview({ x: 100, y: 50 });
    targetOffset.commit();
    await stack.editCoordinator.settled();

    const selection = await positionSelection(new PositionTargets([firstId, lastId], []));
    const scale = PositionEdits.fromSelection(selection).scale(selection.targets, {
      x: 150,
      y: 150,
    });
    scale.preview({ x: 2, y: 1 });

    expect(layer.point(firstId)).toMatchObject({ x: 50, y: 100 });
    expect(targetLayer.point(targetFirstId)).toMatchObject({ x: 150, y: 150 });

    scale.commit();
    await stack.editCoordinator.settled();
    await stack.editCoordinator.undo();
    await stack.editCoordinator.settled();

    expect(layer.point(firstId)).toMatchObject({ x: 100, y: 100 });
    expect(targetLayer.point(targetFirstId)).toMatchObject({ x: 200, y: 150 });
  });

  it("rotates around corresponding pivots and discards every source preview", async () => {
    const targetOffset = targetLayer.positions.move(
      PositionTargets.points([targetFirstId, targetLastId]),
    );
    targetOffset.preview({ x: 100, y: 50 });
    targetOffset.commit();
    await stack.editCoordinator.settled();

    const selection = await positionSelection(new PositionTargets([firstId, lastId], []));
    const rotate = PositionEdits.fromSelection(selection).rotate(selection.targets, {
      x: 150,
      y: 150,
    });
    rotate.preview(Math.PI / 2);

    const referencePreview = layer.point(firstId)!;
    expect(targetLayer.point(targetFirstId)).toMatchObject({
      x: referencePreview.x + 100,
      y: referencePreview.y + 50,
    });

    rotate.discard();
    expect(layer.point(firstId)).toMatchObject({ x: 100, y: 100 });
    expect(targetLayer.point(targetFirstId)).toMatchObject({ x: 200, y: 150 });
  });
});

/** An open diagonal of three points, 100,100 → 150,150 → 200,200. */
const DIAGONAL = {
  contours: [
    {
      points: [
        { x: 100, y: 100, name: "first" },
        { x: 150, y: 150, name: "middle" },
        { x: 200, y: 200, name: "last" },
      ],
    },
  ],
} as const satisfies GlyphFixture;

describe("editing several sources edits the layers matched to the active one", () => {
  const editor = useTestEditor();
  let firstId: PointId;

  beforeEach(async () => {
    ({ first: firstId } = await editor.draw(DIAGONAL));
    await editor.addAxis(WEIGHT);
    await editor.addSource("Bold", { wght: 700 });
  });

  it("publishes only matches for the latest editing source set", async () => {
    await editor.addSource("Black", { wght: 900 });
    editor.clickSource("Regular");
    editor.clickSource("Bold", "toggle");
    editor.clickSource("Black", "toggle");
    editor.clickSource("Bold", "toggle");
    await editor.editSources(["Regular", "Black"]);
    const black = { source: { name: "Black" } };
    const blackBefore = (await editor.point(firstId, black))!;
    const boldBefore = await editor.layerAt("Bold");
    editor.select([firstId]);

    await editor.dragPoint(firstId, { x: 20, y: 0 });

    expect(await editor.point(firstId, black)).toMatchObject({
      x: blackBefore.x + 20,
      y: blackBefore.y,
    });
    expect(await editor.layerAt("Bold")).toEqual(boldBefore);
  });

  it("invalidates complete mappings after a target structure change", async () => {
    editor.clickSource("Bold");
    editor.selectTool("pen");
    await editor.clickAt({ x: 250, y: 250 });
    await editor.settle();
    await editor.editSources(["Regular", "Bold"]);
    const boldBefore = await editor.layerAt("Bold");
    editor.selectTool("select");
    editor.select([firstId]);

    await editor.dragPoint(firstId, { x: 20, y: 0 });

    expect(await editor.point(firstId, { source: { name: "Bold" } })).toBeNull();
    expect(await editor.layerAt("Bold")).toEqual(boldBefore);
  });
});

function requireLayer(layer: GlyphLayer | null): GlyphLayer {
  if (!layer) throw new Error("Expected a glyph layer");
  return layer;
}

function weightAxis() {
  return {
    tag: "wght",
    name: "Weight",
    role: "external" as const,
    axisType: "continuous" as const,
    minimum: 100,
    default: 400,
    maximum: 900,
    labels: [],
    hidden: false,
  };
}
