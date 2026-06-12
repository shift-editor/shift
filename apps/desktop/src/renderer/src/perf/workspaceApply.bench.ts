import { bench, describe } from "vitest";
import type { GlyphName, PointType, Unicode } from "@shift/types";
import { mintContourId, mintPointId } from "@shift/types";
import { createWorkspaceStack } from "@/testing/workspaceStack";

/**
 * End-to-end benchmarks for the workspace editing pipeline: every iteration
 * crosses the sync-lane channel, NAPI, the in-memory Font, and a SQLite
 * transaction — the same path every user edit takes. The interactive budget
 * is one frame; WorkspaceHost.test.ts pins p99 < 50ms as the hard guard.
 */
const stack = createWorkspaceStack();
await stack.client.create();

const created = await stack.client.apply([
  { kind: "createGlyph", name: "A" as GlyphName, unicodes: [65 as Unicode] },
]);
const layerId = created.layers[0]!.layerId;
const glyphId = created.glyphs![0]!.id;
const sourceId = stack.font.defaultSource.id;

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
await stack.client.apply([...squareIntents(100)]);

describe("workspace apply round trip (channel + NAPI + SQLite)", () => {
  let width = 0;

  bench("values-only apply: setXAdvance", async () => {
    width = (width % 900) + 1;
    await stack.client.apply([{ kind: "setXAdvance", setXAdvance: { layerId, width } }]);
  });

  // Paired with its undo so glyph size stays constant across iterations;
  // the number is one structural edit plus one ledger replay.
  bench("structural apply + undo: contour with 4 points", async () => {
    await stack.client.apply([...squareIntents(200)]);
    await stack.client.undo();
  });

  bench("undo + redo replay of a values entry", async () => {
    await stack.client.undo();
    await stack.client.redo();
  });

  bench("replace-grade glyph state pull", async () => {
    await stack.client.glyph(glyphId, sourceId);
  });
});
