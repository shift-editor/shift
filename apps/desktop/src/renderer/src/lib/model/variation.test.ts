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
 * Known gap (font-reactivity follow-up): variation deltas are computed when
 * a glyph model is pulled; edits made to a master AFTER the pull do not
 * refresh an already-open model's interpolation. Tests that interpolate
 * author both masters first, then open.
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
    { kind: "setContourClosed", setContourClosed: { layerId, contourId, closed: true } },
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
      createGlyph: { glyphId, name: "A" as GlyphName, unicodes: [65 as Unicode] },
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
  expect(created.glyphs![0]!.layers).toContainEqual({
    id: regularLayerId,
    sourceId: stack.font.defaultSource.id,
  });

  const weightAxisId = mintAxisId();
  await stack.editCoordinator.apply([
    {
      kind: "createAxis",
      createAxis: {
        axisId: weightAxisId,
        tag: "wght",
        name: "Weight",
        min: 100,
        default: 400,
        max: 900,
        hidden: false,
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
  const bold = sourced.sources!.find((source) => source.name === "Bold")!;
  expect(bold.id).toBe(boldSourceId);
  expect(sourced.layers).toEqual([]);

  const boldLayerId = mintLayerId();
  await stack.editCoordinator.apply([
    {
      kind: "createGlyphLayer",
      createGlyphLayer: { layerId: boldLayerId, glyphId, sourceId: boldSourceId },
    },
  ]);

  // Author both layers before any glyph model opens so the pulled
  // variation deltas cover them.
  await drawSquare(stack, regularLayerId, 100);
  await drawSquare(stack, boldLayerId, 200);
  await stack.editCoordinator.apply([
    { kind: "setXAdvance", setXAdvance: { layerId: regularLayerId, width: 300 } },
  ]);
  await stack.editCoordinator.apply([
    { kind: "setXAdvance", setXAdvance: { layerId: boldLayerId, width: 500 } },
  ]);

  return { stack, glyphId, regularLayerId, boldLayerId, bold };
}

async function loadGlyph(stack: WorkspaceStack, glyphId: GlyphId) {
  await stack.font.ensureGlyphs([glyphId], { sourceIds: [stack.font.defaultSource.id] });
  const glyph = stack.font.glyphForId(glyphId);
  if (!glyph) throw new Error("Expected default glyph layer to load");
  return glyph;
}

async function loadGlyphLayer(stack: WorkspaceStack, glyphId: GlyphId, source: Source) {
  await stack.font.ensureGlyphs([glyphId], {
    sourceIds: [stack.font.defaultSource.id, source.id],
  });
  const layer = stack.font.glyphLayerForId(glyphId, source.id);
  if (!layer) throw new Error("Expected glyph layer to load");
  return layer;
}

describe("variable editing across sources", () => {
  let stack: WorkspaceStack;
  let glyphId: GlyphId;
  let bold: Source;

  beforeEach(async () => {
    ({ stack, glyphId, bold } = await variableFont());
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

  it("interpolates geometry and metrics between masters", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    const axis = stack.font.getAxes()[0]!;

    // wght 550 is halfway between the masters at 400 and 700.
    const mid = withAxisValue(defaultAxisLocation(stack.font.getAxes()), axis, 550);
    const instance = glyph.instanceAt(mid);

    expect(instance.hasLayer).toBe(false);
    expect(instance.xAdvance).toBeCloseTo(300 + (500 - 300) * 0.5);

    const xs = instance.geometry.allPoints.map((point) => point.x);
    expect(Math.max(...xs)).toBeCloseTo(100 + (200 - 100) * 0.5);
  });

  it("resolves live layer geometry at exact master locations", async () => {
    const glyph = await loadGlyph(stack, glyphId);
    await loadGlyphLayer(stack, glyphId, bold);

    const axis = stack.font.getAxes()[0]!;
    const atBold = withAxisValue(defaultAxisLocation(stack.font.getAxes()), axis, 700);
    const instance = glyph.instanceAt(atBold);

    expect(instance.hasLayer).toBe(true);
    expect(instance.hasLayer).toBe(true);
    expect(instance.xAdvance).toBe(500);
  });
});
