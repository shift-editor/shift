import { describe, expect, it, beforeEach } from "vitest";
import type { AxisId, GlyphId, GlyphName, LayerId, Source, Unicode } from "@shift/types";
import { mintAxisId, mintContourId, mintGlyphId, mintPointId } from "@shift/types";
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

  await stack.client.apply([
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
  await stack.client.create();

  const created = await stack.client.apply([
    {
      kind: "createGlyph",
      createGlyph: { glyphId: mintGlyphId(), name: "A" as GlyphName, unicodes: [65 as Unicode] },
    },
  ]);
  const glyphId = created.glyphs![0]!.id;
  const regularLayerId = created.layers[0]!.layerId;

  const weightAxisId = mintAxisId();
  await stack.client.apply([
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
  const sourced = await stack.client.apply([
    {
      kind: "createSource",
      createSource: {
        name: "Bold",
        location: { values: { [weightAxisId]: 700 } as Record<AxisId, number> },
      },
    },
  ]);
  const boldLayerId = sourced.layers[0]!.layerId;
  const bold = sourced.sources!.find((source) => source.name === "Bold")!;

  // Author both masters before any glyph model opens so the pulled
  // variation deltas cover them.
  await drawSquare(stack, regularLayerId, 100);
  await drawSquare(stack, boldLayerId, 200);
  await stack.client.apply([
    { kind: "setXAdvance", setXAdvance: { layerId: regularLayerId, width: 300 } },
  ]);
  await stack.client.apply([
    { kind: "setXAdvance", setXAdvance: { layerId: boldLayerId, width: 500 } },
  ]);

  return { stack, glyphId, regularLayerId, boldLayerId, bold };
}

describe("variable editing across sources", () => {
  let stack: WorkspaceStack;
  let glyphId: GlyphId;
  let bold: Source;

  beforeEach(async () => {
    ({ stack, glyphId, bold } = await variableFont());
  });

  it("opens an editable glyph source at a non-default master", async () => {
    const boldSource = await stack.font.openGlyphSource(glyphId, bold);

    expect(boldSource).not.toBeNull();
    expect(boldSource!.contours.length).toBe(1);
    expect(boldSource!.xAdvance).toBe(500);
  });

  it("folds echoes for edits made on a non-default master", async () => {
    const boldSource = (await stack.font.openGlyphSource(glyphId, bold))!;
    const point = boldSource.allPoints[1]!;

    boldSource.commitPositionPatch([{ kind: "point", id: point.id, x: 250, y: 0 }]);
    await stack.writer.settled();

    expect(boldSource.point(point.id)).toMatchObject({ x: 250, y: 0 });

    const undone = await stack.writer.undo();
    expect(undone).not.toBeNull();
    expect(boldSource.point(point.id)).toMatchObject({ x: 200, y: 0 });
  });

  it("interpolates geometry and metrics between masters", async () => {
    const glyph = (await stack.font.openGlyph(glyphId, stack.font.defaultSource))!;
    const axis = stack.font.getAxes()[0]!;

    // wght 550 is halfway between the masters at 400 and 700.
    const mid = withAxisValue(defaultAxisLocation(stack.font.getAxes()), axis, 550);
    const instance = glyph.instanceAt(mid);

    expect(instance.hasSource).toBe(false);
    expect(instance.xAdvance).toBeCloseTo(300 + (500 - 300) * 0.5);

    const xs = instance.geometry.allPoints.map((point) => point.x);
    expect(Math.max(...xs)).toBeCloseTo(100 + (200 - 100) * 0.5);
  });

  it("resolves live editable geometry at exact master locations", async () => {
    const glyph = (await stack.font.openGlyph(glyphId, stack.font.defaultSource))!;
    await stack.font.openGlyphSource(glyphId, bold);

    const axis = stack.font.getAxes()[0]!;
    const atBold = withAxisValue(defaultAxisLocation(stack.font.getAxes()), axis, 700);
    const instance = glyph.instanceAt(atBold);

    expect(instance.hasSource).toBe(true);
    expect(instance.editable).toBe(true);
    expect(instance.xAdvance).toBe(500);
  });
});
