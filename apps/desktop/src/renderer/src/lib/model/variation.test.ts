import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Axis, AxisId, GlyphId, GlyphName, LayerId, Source, Unicode } from "@shift/types";
import {
  mintAxisId,
  mintAxisMappingId,
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  mintSourceId,
} from "@shift/types";
import {
  defaultExternalAxisLocation,
  externalAxisLocationFromLocation,
  externalAxisLocationFromRecord,
  withExternalAxisValue,
} from "@shift/editor/variation";
import { signal } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";

/**
 * Restores the blocked variation coverage (variation.test.ts + the Glyph
 * interpolation suite from the WS6 inventory) on the workspace stack: the
 * two-master font is authored through intents instead of MutatorSans.
 *
 * Interpolated render models combine a coordinate-independent native basis
 * with current authored layer signals. Numeric master edits therefore update
 * an existing render model without pulling or rebuilding native variation data.
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

function continuousAxis(axisId: AxisId): Axis {
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
  const glyph = await stack.font.loadGlyph(glyphId);
  const layer = glyph.layerForSource(source.id);
  if (!layer) throw new Error("Expected glyph layer to load");
  return layer;
}

it("maps external locations once across source creation, instances, and exact layers", async () => {
  const editor = new TestEditor();
  await editor.startSession();
  const glyph = editor.glyphForId(editor.glyphRecord!.id)!;
  editor.requireGlyphLayer().setXAdvance(300);
  await editor.settle();

  const axisId = editor.font.createAxis({
    tag: "wght",
    name: "Weight",
    role: "external",
    axisType: "continuous",
    minimum: 100,
    default: 400,
    maximum: 900,
    labels: [],
    hidden: false,
  });
  await editor.settle();
  await editor.font.setAxisMappings([
    {
      id: mintAxisMappingId(),
      name: "Weight curve",
      inputs: [axisId],
      outputs: [axisId],
      points: [
        { input: { values: { [axisId]: 100 } }, output: { values: { [axisId]: 100 } } },
        { input: { values: { [axisId]: 400 } }, output: { values: { [axisId]: 400 } } },
        { input: { values: { [axisId]: 900 } }, output: { values: { [axisId]: 800 } } },
      ],
    },
  ]);

  const blackExternal = externalAxisLocationFromRecord({ [axisId]: 900 });
  const blackSourceId = editor.createSource("Black", blackExternal);
  await editor.settle();
  glyph.layerForSource(blackSourceId)!.setXAdvance(500);
  await editor.settle();

  const blackSource = editor.font.source(blackSourceId);
  if (!blackSource) throw new Error("Expected Black source");
  expect(blackSource.location.values[axisId]).toBeCloseTo(800);
  expect(editor.font.sourceAt(blackExternal)?.id).toBe(blackSourceId);
  expect(glyph.layerAt(blackExternal)?.sourceId).toBe(blackSourceId);

  const instanceId = editor.font.createNamedInstance({
    name: "Black",
    location: { values: { [axisId]: 900 } },
    postscriptName: "UntitledFont-Black",
  });
  await editor.settle();
  const instance = editor.font.namedInstances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error("Expected Black instance");

  editor.setSourceToDefault();
  editor.setExternalLocation(externalAxisLocationFromLocation(instance.location));
  expect(editor.activeSourceId).toBe(blackSourceId);
  expect(editor.sceneGlyphRenderModel?.xAdvance).toBe(500);

  editor.setSourceToDefault();
  editor.selectSource(blackSourceId);
  expect(editor.activeSourceId).toBe(blackSourceId);
  expect(editor.externalLocation.get(axisId)).toBeCloseTo(900);
  expect(editor.sceneGlyphRenderModel?.xAdvance).toBe(500);
});

describe("mapped weights retain design-space interpolation", () => {
  const fixture = resolve(process.cwd(), "../../fixtures/fonts/MappedWeight.glyphs");
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.openSession(fixture, "A");
  });

  it.each([
    [100, 30, 300, 700],
    [250, 58, 450, 750],
    [400, 86, 600, 800],
    [681.25, 123, 750, 850],
    [800, 160, 900, 900],
  ])(
    "renders weight %s with the mapped outline, advance, and metrics",
    (weight, x, advance, ascender) => {
      const axisId = editor.font.getAxes()[0]!.id;
      const model = editor.sceneGlyphRenderModel!;
      editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: weight }));

      expect(Math.max(...model.allPoints.map((point) => point.x))).toBeCloseTo(x);
      expect(model.xAdvance).toBeCloseTo(advance);
      expect(editor.font.metricsAtLocation(editor.externalLocation).ascender).toBeCloseTo(ascender);
    },
  );

  it("preserves mapped interpolation after Save As and a fresh reopen", async () => {
    const root = mkdtempSync(join(tmpdir(), "shift-mapped-weight-"));
    const saved = join(root, "Mapped.shift");
    try {
      await editor.saveAs(saved);
      await editor.closeSession();
      const reopened = new TestEditor();
      await reopened.openSession(saved, "A");
      const axisId = reopened.font.getAxes()[0]!.id;
      reopened.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 250 }));
      expect(reopened.sceneGlyphRenderModel!.xAdvance).toBeCloseTo(450);
      expect(
        Math.max(...reopened.sceneGlyphRenderModel!.allPoints.map((point) => point.x)),
      ).toBeCloseTo(58);
      expect(reopened.font.metricsAtLocation(reopened.externalLocation).ascender).toBeCloseTo(750);
      await reopened.closeSession();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces cached glyph and metric normalization after mapping edits and undo", async () => {
    const stack = createWorkspaceStack();
    await stack.openWorkspace(fixture);
    const glyph = await stack.font.loadGlyph(stack.font.recordForName("A" as GlyphName)!.id);
    const axisId = stack.font.getAxes()[0]!.id;
    const mapping = stack.font.getAxisMappings()[0]!;
    await stack.font.setAxisMappings([
      {
        ...mapping,
        points: mapping.points.map((point) => ({
          ...point,
          output: {
            values: {
              [axisId]: Math.max(
                point.output.values[axisId]!,
                86 + (point.output.values[axisId]! - 86) * 2,
              ),
            },
          },
        })),
      },
    ]);

    expect(
      stack.store.projection(glyph.id)!.interpolation!.basis.designNormalization[0]!.maximum,
    ).toBeCloseTo(234);
    expect(
      stack.client.workspaceCell.peek()!.sourceMetricsInterpolation!.basis.designNormalization[0]!
        .maximum,
    ).toBeCloseTo(234);
    await stack.editCoordinator.undo();
    expect(
      stack.store.projection(glyph.id)!.interpolation!.basis.designNormalization[0]!.maximum,
    ).toBe(160);
    expect(
      stack.client.workspaceCell.peek()!.sourceMetricsInterpolation!.basis.designNormalization[0]!
        .maximum,
    ).toBe(160);
  });

  it("refreshes an existing render model and metrics when mappings change", async () => {
    const axisId = editor.font.getAxes()[0]!.id;
    const model = editor.sceneGlyphRenderModel!;
    editor.setExternalLocation(externalAxisLocationFromRecord({ [axisId]: 681.25 }));
    expect(model.xAdvance).toBeCloseTo(750);
    const mapping = editor.font.getAxisMappings()[0]!;

    await editor.font.setAxisMappings([
      {
        ...mapping,
        points: mapping.points.map((point) => ({
          ...point,
          output: {
            values: {
              [axisId]:
                point.output.values[axisId]! <= 86
                  ? point.output.values[axisId]!
                  : 86 + (point.output.values[axisId]! - 86) * 2,
            },
          },
        })),
      },
    ]);

    expect(model.xAdvance).toBeCloseTo(900);
    expect(Math.max(...model.allPoints.map((point) => point.x))).toBeCloseTo(160);
    expect(editor.font.metricsAtLocation(editor.externalLocation).ascender).toBeCloseTo(900);
    await editor.undo();
    expect(model.xAdvance).toBeCloseTo(750);
    expect(editor.font.metricsAtLocation(editor.externalLocation).ascender).toBeCloseTo(850);
  });
});

describe("variable editing across sources", () => {
  let stack: WorkspaceStack;
  let glyphId: GlyphId;
  let regularLayerId: LayerId;
  let boldLayerId: LayerId;
  let bold: Source;

  beforeEach(async () => {
    ({ stack, glyphId, regularLayerId, boldLayerId, bold } = await variableFont());
  });

  it("opens an authored glyph layer at a non-default master", async () => {
    const boldSource = await loadGlyphLayer(stack, glyphId, bold);

    expect(boldSource.contours.length).toBe(1);
    expect(boldSource.xAdvance).toBe(500);
  });

  it("folds echoes for edits made on a non-default master", async () => {
    const boldSource = await loadGlyphLayer(stack, glyphId, bold);
    const point = boldSource.allPoints[1]!;

    boldSource.applyPositionPatch([{ kind: "point", id: point.id, x: 250, y: 0 }]);
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
    const mid = withExternalAxisValue(defaultExternalAxisLocation(stack.font.getAxes()), axis, 550);
    const renderModel = glyph.renderModelAt(signal(mid));

    expect(glyph.layerAt(mid)).toBeNull();
    expect(glyph.geometryAt(mid).xAdvance).toBeCloseTo(300 + (500 - 300) * 0.5);
    expect(renderModel.xAdvance).toBeCloseTo(300 + (500 - 300) * 0.5);
    expect(stack.font.metricsAtLocation(mid).ascender).toBeCloseTo(850);
    expect(stack.font.metricsAtLocation(mid).xHeight).toBeCloseTo(550);

    const xs = renderModel.allPoints.map((point) => point.x);
    expect(Math.max(...xs)).toBeCloseTo(100 + (200 - 100) * 0.5);
  });

  it("materializes interpolated geometry and metrics at a new source", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    const axis = stack.font.getAxes()[0]!;
    const location = withExternalAxisValue(
      defaultExternalAxisLocation(stack.font.getAxes()),
      axis,
      550,
    );
    const sourceId = stack.editCoordinator.transaction("Create source", () => {
      const id = stack.font.createSource(
        "Medium",
        externalAxisLocationFromRecord({ [axis.id]: 550 }),
      );
      stack.font.materializeGlyphLayer(
        glyph.id,
        id,
        regularLayerId,
        glyph.geometryAt(location).values,
      );
      return id;
    });
    await stack.editCoordinator.settled();

    const layer = glyph.layerForSource(sourceId);
    if (!layer) throw new Error("Expected materialized source layer");

    expect(layer.xAdvance).toBeCloseTo(400);
    expect(Math.max(...layer.geometry.allPoints.map((point) => point.x))).toBeCloseTo(150);
    expect(layer.contours[0]?.points.map((point) => point.id)).not.toEqual(
      glyph
        .layerForSource(stack.font.defaultSource.id)
        ?.contours[0]?.points.map((point) => point.id),
    );
    expect(stack.font.metricsForSource(sourceId).ascender).toBeCloseTo(850);
    expect(stack.font.metricsForSource(sourceId).xHeight).toBeCloseTo(550);
  });

  it("resolves live layer geometry at exact master locations", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    await loadGlyphLayer(stack, glyphId, bold);

    const axis = stack.font.getAxes()[0]!;
    const atBold = withExternalAxisValue(
      defaultExternalAxisLocation(stack.font.getAxes()),
      axis,
      700,
    );
    const renderModel = glyph.renderModelAt(signal(atBold));

    expect(glyph.layerAt(atBold)?.id).toBe(boldLayerId);
    expect(renderModel.xAdvance).toBe(500);
  });

  it("updates an existing interpolated render model after a master value edit", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    const boldSource = await loadGlyphLayer(stack, glyphId, bold);
    const axis = stack.font.getAxes()[0]!;
    const mid = withExternalAxisValue(defaultExternalAxisLocation(stack.font.getAxes()), axis, 550);
    const renderModel = glyph.renderModelAt(signal(mid));

    boldSource.setXAdvance(700);
    await stack.editCoordinator.settled();

    expect(renderModel.xAdvance).toBe(500);
    expect(glyph.geometryAt(mid).xAdvance).toBe(500);
  });
});
