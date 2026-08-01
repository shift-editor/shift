import { afterAll, bench, describe } from "vitest";
import type { GlyphName, PointType, Unicode } from "@shift/types";
import { mintContourId, mintGlyphId, mintLayerId, mintPointId } from "@shift/types";
import { createWorkspaceStack } from "@/testing/workspaceStack";

/**
 * End-to-end benchmarks for the workspace editing pipeline: every iteration
 * crosses the sync-lane channel, NAPI, the in-memory Font, and a SQLite
 * transaction — the same path every user edit takes. The interactive budget
 * is one frame; WorkspaceHost.test.ts pins p99 < 50ms as the hard guard.
 */
const stack = createWorkspaceStack();
await stack.createWorkspace();

const glyphId = mintGlyphId();
const layerId = mintLayerId();
const created = await stack.editCoordinator.apply([
  {
    kind: "createGlyph",
    createGlyph: { glyphId, name: "A" as GlyphName, unicodes: [65 as Unicode] },
  },
  {
    kind: "createGlyphLayer",
    createGlyphLayer: { layerId, glyphId, sourceId: stack.font.defaultSource.id },
  },
]);
if (!created.next?.glyphs?.[0]?.layers.find((layer) => layer.id === layerId)) {
  throw new Error("createGlyphLayer did not echo sparse layer membership");
}

function squareIntents(width: number) {
  const contourId = mintContourId();
  const corners: Array<[number, number]> = [
    [0, 0],
    [width, 0],
    [width, width],
    [0, width],
  ];

  return [
    { kind: "addContour", addContour: { layerId, contourId, closed: false } },
    {
      kind: "addPoints",
      addPoints: {
        layerId,
        contourId,
        points: corners.map(([x, y]) => ({
          id: mintPointId(),
          x,
          y,
          pointType: "onCurve" as PointType,
          smooth: false,
        })),
      },
    },
    { kind: "setContourClosed", setContourClosed: { layerId, contourId, closed: true } },
  ] as const;
}

// Seed one contour so undo/redo and pulls always have real geometry.
await stack.editCoordinator.apply([...squareIntents(100)]);

const LARGE_POINT_COUNT = 50_000;
const largeStack = createWorkspaceStack();
await largeStack.createWorkspace();
const largeGlyphId = mintGlyphId();
const largeLayerId = mintLayerId();
const largeContourId = mintContourId();
const largePointIds = Array.from({ length: LARGE_POINT_COUNT }, () => mintPointId());
const largePoints = largePointIds.map((id, index) => ({
  id,
  x: index % 500,
  y: Math.floor(index / 500),
  pointType: "onCurve" as PointType,
  smooth: false,
}));
const largeCreated = await largeStack.editCoordinator.apply([
  {
    kind: "createGlyph",
    createGlyph: { glyphId: largeGlyphId, name: "large" as GlyphName, unicodes: [] },
  },
  {
    kind: "createGlyphLayer",
    createGlyphLayer: {
      layerId: largeLayerId,
      glyphId: largeGlyphId,
      sourceId: largeStack.font.defaultSource.id,
    },
  },
  {
    kind: "addContour",
    addContour: { layerId: largeLayerId, contourId: largeContourId, closed: true },
  },
  {
    kind: "addPoints",
    addPoints: {
      layerId: largeLayerId,
      contourId: largeContourId,
      points: largePoints,
    },
  },
]);
if (largeCreated.layers[0]?.structure?.contours[0]?.points.length !== LARGE_POINT_COUNT) {
  throw new Error("50K benchmark setup did not create the complete contour");
}
await largeStack.editCoordinator.apply([
  {
    kind: "movePoints",
    movePoints: {
      layerId: largeLayerId,
      pointIds: largePointIds,
      coords: largePoints.flatMap((point) => [point.x + 1, point.y - 1]),
    },
  },
]);

const largeUndoSamples: number[] = [];
const largeRedoSamples: number[] = [];

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * fraction)] ?? 0;
}

afterAll(() => {
  console.log(
    `50K position replay: undo p50=${percentile(largeUndoSamples, 0.5).toFixed(2)}ms p95=${percentile(largeUndoSamples, 0.95).toFixed(2)}ms; redo p50=${percentile(largeRedoSamples, 0.5).toFixed(2)}ms p95=${percentile(largeRedoSamples, 0.95).toFixed(2)}ms`,
  );
});

describe("workspace apply round trip (channel + NAPI + SQLite)", () => {
  let width = 0;

  bench("values-only apply: setXAdvance", async () => {
    width = (width % 900) + 1;
    await stack.editCoordinator.apply([{ kind: "setXAdvance", setXAdvance: { layerId, width } }]);
  });

  // Paired with its undo so glyph size stays constant across iterations;
  // the number is one structural edit plus one ledger replay.
  bench("structural apply + undo: contour with 4 points", async () => {
    await stack.editCoordinator.apply([...squareIntents(200)]);
    await stack.editCoordinator.undo();
  });

  bench("undo + redo replay of a values entry", async () => {
    await stack.editCoordinator.undo();
    await stack.editCoordinator.redo();
  });

  bench("replace-grade glyph state pull", async () => {
    await stack.editCoordinator.readGlyphSnapshots([{ glyphId }]);
  });

  bench(
    "50K point position-only undo + redo",
    async () => {
      let started = performance.now();
      const undone = await largeStack.editCoordinator.undo();
      largeUndoSamples.push(performance.now() - started);
      if (!undone || undone.layers.length !== 1) {
        throw new Error("50K position edit did not undo exactly one layer");
      }
      if (undone.layers[0].structure) {
        throw new Error("50K position undo crossed the bridge with structure");
      }

      started = performance.now();
      const redone = await largeStack.editCoordinator.redo();
      largeRedoSamples.push(performance.now() - started);
      if (!redone || redone.layers.length !== 1) {
        throw new Error("50K position edit did not redo exactly one layer");
      }
      if (redone.layers[0].structure) {
        throw new Error("50K position redo crossed the bridge with structure");
      }
    },
    { iterations: 10, time: 0, warmupIterations: 0, warmupTime: 0 },
  );
});
