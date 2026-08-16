import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AxisId,
  AxisMappingId,
  GlyphId,
  LayerId,
  NamedInstanceId,
  PointId,
  SourceId,
} from "@shift/types";
import { mintAxisMappingId } from "@shift/types";
import { describe, expect, it } from "vitest";
import {
  defaultExternalAxisLocation,
  externalAxisLocationFromRecord,
  withExternalAxisValue,
} from "@/lib/variation/location";
import { TestEditor } from "@/testing/TestEditor";

interface VariableFixture {
  axisId: AxisId;
  mappingId: AxisMappingId;
  glyphId: GlyphId;
  regularSourceId: SourceId;
  regularLayerId: LayerId;
  boldSourceId: SourceId;
  boldLayerId: LayerId;
  boldPointId: PointId;
  instanceId: NamedInstanceId;
}

async function authorVariableFont(editor: TestEditor): Promise<VariableFixture> {
  await editor.startSession();
  const inserted = editor.insertContent({
    contours: [
      {
        closed: true,
        points: [
          { x: 0, y: 0, pointType: "onCurve", smooth: false },
          { x: 100, y: 0, pointType: "onCurve", smooth: false },
          { x: 100, y: 100, pointType: "onCurve", smooth: false },
          { x: 0, y: 100, pointType: "onCurve", smooth: false },
        ],
      },
    ],
  });
  if (!inserted) throw new Error("Expected regular contour");

  editor.setXAdvance(400);
  await editor.settle();
  const glyphId = editor.glyphRecord?.id;
  const regularLayer = editor.requireGlyphLayer();
  if (!glyphId) throw new Error("Expected authored glyph");

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
  const mappingId = mintAxisMappingId();
  await editor.font.setAxisMappings([
    {
      id: mappingId,
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

  const boldSourceId = editor.createSource(
    "Bold",
    externalAxisLocationFromRecord({ [axisId]: 900 }),
  );
  await editor.settle();
  const boldLayer = editor.glyphForId(glyphId)?.layerForSource(boldSourceId);
  if (!boldLayer) throw new Error("Expected materialized Bold layer");
  const boldPoint = boldLayer.allPoints[0];
  if (!boldPoint) throw new Error("Expected Bold point");

  editor.selectTool("select");
  editor.selection.select([boldPoint.id]);
  editor.dragScene({
    down: boldPoint,
    start: { x: boldPoint.x + 4, y: boldPoint.y },
    end: { x: boldPoint.x + 44, y: boldPoint.y + 20 },
  });
  editor.setXAdvance(700);
  await editor.settle();

  const bold = editor.font.source(boldSourceId);
  if (!bold) throw new Error("Expected Bold source");
  const ascender = editor.font.metricDefinitions.find(({ kind }) => kind === "ascender");
  const xHeight = editor.font.metricDefinitions.find(({ kind }) => kind === "xHeight");
  if (!ascender || !xHeight) throw new Error("Expected standard metric definitions");
  await editor.font.updateSource({
    ...bold,
    lineGap: 24,
    metricValues: bold.metricValues.map((value) => {
      switch (value.metricId) {
        case ascender.id:
          return { ...value, position: 920 };
        case xHeight.id:
          return { ...value, position: 620 };
        default:
          return value;
      }
    }),
  });

  const instanceId = editor.font.createNamedInstance({
    name: "Bold",
    postscriptName: "Untitled-Bold",
    location: { values: { [axisId]: 900 } },
  });
  await editor.settle();
  return {
    axisId,
    mappingId,
    glyphId,
    regularSourceId: editor.font.defaultSource.id,
    regularLayerId: regularLayer.id,
    boldSourceId,
    boldLayerId: boldLayer.id,
    boldPointId: boldPoint.id,
    instanceId,
  };
}

function persistedVariableFont(editor: TestEditor, fixture: VariableFixture) {
  const glyph = editor.glyphForId(fixture.glyphId);
  const regular = glyph?.layerForSource(fixture.regularSourceId);
  const bold = glyph?.layerForSource(fixture.boldSourceId);
  const axis = editor.font.getAxes().find(({ id }) => id === fixture.axisId);
  const mapping = editor.font.getAxisMappings().find(({ id }) => id === fixture.mappingId);
  const source = editor.font.source(fixture.boldSourceId);
  const instance = editor.font.namedInstances.find(({ id }) => id === fixture.instanceId);
  if (!glyph || !regular || !bold || !axis || !mapping || !source || !instance) {
    throw new Error("Expected complete variable font");
  }

  const middle = withExternalAxisValue(
    defaultExternalAxisLocation(editor.font.getAxes()),
    axis,
    650,
  );
  const middleGeometry = glyph.geometryAt(middle);
  const middlePoint = middleGeometry.allPoints[0];
  if (!middlePoint) throw new Error("Expected interpolated point");

  return {
    axis,
    mapping,
    source,
    instance,
    glyphId: glyph.id,
    regular: {
      id: regular.id,
      xAdvance: regular.xAdvance,
      contourIds: regular.contours.map(({ id }) => id),
      pointIds: regular.allPoints.map(({ id }) => id),
    },
    bold: {
      id: bold.id,
      xAdvance: bold.xAdvance,
      contourIds: bold.contours.map(({ id }) => id),
      pointIds: bold.allPoints.map(({ id }) => id),
      firstPoint: { x: bold.allPoints[0]?.x, y: bold.allPoints[0]?.y },
    },
    middle: {
      hasExactLayer: glyph.layerAt(middle) !== null,
      xAdvance: middleGeometry.xAdvance,
      firstPoint: { x: middlePoint.x, y: middlePoint.y },
      ascender: editor.font.metricsAtLocation(middle).ascender,
      xHeight: editor.font.metricsAtLocation(middle).xHeight,
    },
  };
}

describe("saved variable-font outcomes survive a fresh workspace stack", () => {
  it("reopens stable designspace identities, exact layers, interpolation, and metrics", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-variable-reopen-"));
    const savePath = join(outputRoot, "VariableRoundTrip.shift");
    const original = new TestEditor();
    const fixture = await authorVariableFont(original);
    await expect(original.saveAs(savePath)).resolves.toMatchObject({ dirty: false });
    const expected = persistedVariableFont(original, fixture);
    expect(expected.source.location.values[fixture.axisId]).toBe(800);
    expect(expected.middle).toMatchObject({
      hasExactLayer: false,
      xAdvance: 550,
      firstPoint: { x: 20, y: 10 },
      ascender: 860,
      xHeight: 560,
    });
    await original.closeSession();

    const reopened = new TestEditor();
    await reopened.openSession(savePath, "A");
    await expect(reopened.font.editCoordinator.state()).resolves.toMatchObject({ dirty: false });
    expect(persistedVariableFont(reopened, fixture)).toEqual(expected);

    reopened.selectSourceForEditing(fixture.boldSourceId);
    const boldPoint = reopened.requireGlyphLayer().point(fixture.boldPointId);
    if (!boldPoint) throw new Error("Expected reopened Bold point");
    const savedPosition = { x: boldPoint.x, y: boldPoint.y };
    reopened.selectTool("select");
    reopened.selection.select([boldPoint.id]);
    const drag = reopened.dragScene({
      down: savedPosition,
      start: { x: savedPosition.x + 4, y: savedPosition.y },
      end: { x: savedPosition.x + 24, y: savedPosition.y + 30 },
    });
    await reopened.settle();
    const editedPosition = reopened.pointPosition(boldPoint.id);
    expect(editedPosition).toEqual({
      x: savedPosition.x + drag.delta.x,
      y: savedPosition.y + drag.delta.y,
    });
    await expect(reopened.font.editCoordinator.state()).resolves.toMatchObject({ dirty: true });

    await reopened.undoAndSettle();
    expect(reopened.pointPosition(boldPoint.id)).toEqual(savedPosition);
    await expect(reopened.font.editCoordinator.state()).resolves.toMatchObject({ dirty: false });
    await reopened.redoAndSettle();
    expect(reopened.pointPosition(boldPoint.id)).toEqual(editedPosition);
    await reopened.save();
    await reopened.closeSession();
    rmSync(outputRoot, { recursive: true, force: true });
  });
});
