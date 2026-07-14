import { describe, expect, it, beforeEach } from "vitest";
import type { AxisId, GlyphId, GlyphName, LayerId, Source, Unicode } from "@shift/types";
import {
  mintAxisId,
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  mintSourceId,
} from "@shift/types";
import { defaultAxisLocation, withAxisValue } from "@/lib/variation/location";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";

/**
 * Restores the blocked variation coverage (variation.test.ts + the Glyph
 * interpolation suite from the WS6 inventory) on the workspace stack: the
 * two-master font is authored through intents instead of MutatorSans.
 *
 * Interpolated views combine a coordinate-independent native basis with the
 * current authored layer signals. Numeric master edits therefore update an
 * existing view without pulling or rebuilding native variation data.
 */
const SQUARE = (width: number): Array<[number, number]> => [
  [0, 0],
  [width, 0],
  [width, 100],
  [0, 100],
];

async function drawSquare(stack: WorkspaceStack, layerId: LayerId, width: number): Promise<void> {
  const contourId = mintContourId();

  await stack.editCoordinator.apply([
    { kind: "addContour", addContour: { layerId, contourId, closed: false } },
    {
      kind: "addPoints",
      addPoints: {
        layerId,
        contourId,
        points: SQUARE(width).map(([x, y]) => ({
          id: mintPointId(),
          x,
          y,
          pointType: "onCurve" as const,
          smooth: false,
        })),
      },
    },
    {
      kind: "setContourClosed",
      setContourClosed: { layerId, contourId, closed: true },
    },
  ]);
}

async function variableFont(): Promise<{
  stack: WorkspaceStack;
  glyphId: GlyphId;
  regularLayerId: LayerId;
  boldLayerId: LayerId;
  bold: Source;
}> {
  const stack = createWorkspaceStack();
  await stack.createWorkspace();

  const glyphId = mintGlyphId();
  const regularLayerId = mintLayerId();
  const created = await stack.editCoordinator.apply([
    {
      kind: "createGlyph",
      createGlyph: {
        glyphId,
        name: "A" as GlyphName,
        unicodes: [65 as Unicode],
      },
    },
    {
      kind: "createGlyphLayer",
      createGlyphLayer: {
        layerId: regularLayerId,
        glyphId,
        sourceId: stack.font.defaultSource.id,
      },
    },
  ]);
  expect(created.next?.glyphs?.[0]?.layers).toContainEqual({
    id: regularLayerId,
    sourceId: stack.font.defaultSource.id,
  });

  const weightAxisId = mintAxisId();
  await stack.editCoordinator.apply([
    {
      kind: "createAxis",
      createAxis: {
        axis: continuousAxis(weightAxisId),
      },
    },
  ]);
  const boldSourceId = mintSourceId();
  const sourced = await stack.editCoordinator.apply([
    {
      kind: "createSource",
      createSource: {
        sourceId: boldSourceId,
        name: "Bold",
        location: { values: { [weightAxisId]: 700 } as Record<AxisId, number> },
      },
    },
  ]);
  const bold = sourced.next?.sources?.find((source) => source.name === "Bold");
  if (!bold) throw new Error("createSource did not echo the source");
  expect(bold.id).toBe(boldSourceId);
  expect(sourced.layers).toEqual([]);

  const ascender = stack.font.metricDefinitions.find(
    (definition) => definition.kind === "ascender",
  );
  if (!ascender) throw new Error("Expected the default ascender definition");
  const xHeight = stack.font.metricDefinitions.find((definition) => definition.kind === "xHeight");
  if (!xHeight) throw new Error("Expected the default x-height definition");
  const variedMetricPositions = new Map([
    [ascender.id, 900],
    [xHeight.id, 600],
  ]);
  await stack.font.updateSource({
    ...bold,
    metricValues: bold.metricValues.map((value) =>
      variedMetricPositions.has(value.metricId)
        ? { ...value, position: variedMetricPositions.get(value.metricId)! }
        : value,
    ),
  });
  const updatedBold = stack.font.source(boldSourceId);
  if (!updatedBold) throw new Error("Expected the updated Bold source");

  const boldLayerId = mintLayerId();
  await stack.editCoordinator.apply([
    {
      kind: "createGlyphLayer",
      createGlyphLayer: {
        layerId: boldLayerId,
        glyphId,
        sourceId: boldSourceId,
      },
    },
  ]);

  // Author both layers before any glyph model opens so the pulled
  // variation deltas cover them.
  await drawSquare(stack, regularLayerId, 100);
  await drawSquare(stack, boldLayerId, 200);
  await stack.editCoordinator.apply([
    {
      kind: "setXAdvance",
      setXAdvance: { layerId: regularLayerId, width: 300 },
    },
  ]);
  await stack.editCoordinator.apply([
    { kind: "setXAdvance", setXAdvance: { layerId: boldLayerId, width: 500 } },
  ]);

  return { stack, glyphId, regularLayerId, boldLayerId, bold: updatedBold };
}

function continuousAxis(axisId: AxisId) {
  return {
    id: axisId,
    tag: "wght",
    name: "Weight",
    role: "external",
    axisType: "continuous",
    minimum: 100,
    default: 400,
    maximum: 900,
    labels: [],
    hidden: false,
  };
}

async function loadGlyph(stack: WorkspaceStack, glyphId: GlyphId) {
  return stack.font.loadGlyph(glyphId);
}

async function loadGlyphLayer(stack: WorkspaceStack, glyphId: GlyphId, source: Source) {
  await stack.font.loadGlyph(glyphId);
  const layer = stack.font.layer(glyphId, source.id);
  if (!layer) throw new Error("Expected glyph layer to load");
  return layer;
}

describe("variable editing across sources", () => {
  let stack: WorkspaceStack;
  let glyphId: GlyphId;
  let boldLayerId: LayerId;
  let bold: Source;

  beforeEach(async () => {
    ({ stack, glyphId, boldLayerId, bold } = await variableFont());
  });

  it("opens an authored glyph layer at a non-default master", async () => {
    const boldSource = await loadGlyphLayer(stack, glyphId, bold);

    expect(boldSource.contours.length).toBe(1);
    expect(boldSource.xAdvance).toBe(500);
  });

  it("folds echoes for edits made on a non-default master", async () => {
    const boldSource = await loadGlyphLayer(stack, glyphId, bold);
    const point = boldSource.allPoints[1]!;

    boldSource.commitPositionPatch([{ kind: "point", id: point.id, x: 250, y: 0 }]);
    await stack.editCoordinator.settled();

    expect(boldSource.point(point.id)).toMatchObject({ x: 250, y: 0 });

    const undone = await stack.editCoordinator.undo();
    expect(undone).not.toBeNull();
    expect(boldSource.point(point.id)).toMatchObject({ x: 200, y: 0 });
  });

  it("interpolates geometry, advances, and source metrics between masters", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    const axis = stack.font.getAxes()[0]!;

    // wght 550 is halfway between the masters at 400 and 700.
    const mid = withAxisValue(defaultAxisLocation(stack.font.getAxes()), axis, 550);
    const view = stack.font.glyphView(glyph.id, mid);
    if (!view) throw new Error("Expected glyph view");

    expect(stack.font.editableLayerAt(glyph.id, mid)).toBeNull();
    expect(view.xAdvance).toBeCloseTo(300 + (500 - 300) * 0.5);
    expect(stack.font.metricsAtLocation(mid).ascender).toBeCloseTo(850);
    expect(stack.font.metricsAtLocation(mid).xHeight).toBeCloseTo(550);

    const xs = view.geometry.allPoints.map((point) => point.x);
    expect(Math.max(...xs)).toBeCloseTo(100 + (200 - 100) * 0.5);
  });

  it("resolves live layer geometry at exact master locations", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    await loadGlyphLayer(stack, glyphId, bold);

    const axis = stack.font.getAxes()[0]!;
    const atBold = withAxisValue(defaultAxisLocation(stack.font.getAxes()), axis, 700);
    const view = stack.font.glyphView(glyph.id, atBold);
    if (!view) throw new Error("Expected glyph view");

    expect(stack.font.editableLayerAt(glyph.id, atBold)?.id).toBe(boldLayerId);
    expect(view.xAdvance).toBe(500);
  });

  it("updates an existing interpolated view after a master value edit", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    const boldSource = await loadGlyphLayer(stack, glyphId, bold);
    const axis = stack.font.getAxes()[0]!;
    const mid = withAxisValue(defaultAxisLocation(stack.font.getAxes()), axis, 550);
    const view = stack.font.glyphView(glyph.id, mid);
    if (!view) throw new Error("Expected glyph view");

    boldSource.setXAdvance(700);
    await stack.editCoordinator.settled();

    expect(view.xAdvance).toBe(500);
  });
});
