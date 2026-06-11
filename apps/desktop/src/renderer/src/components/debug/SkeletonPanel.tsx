import { useState } from "react";
import { mintContourId, mintPointId, type LayerId, type PointType } from "@shift/types";
import { getWorkspace } from "@/store/appStore";
import { isDev } from "@/lib/utils/utils";

/**
 * CS0 walking-skeleton panel (dev builds only; deleted when CS3's real
 * editing surface lands). Drives `workspace.apply` through the production
 * stack: add a glyph (visible in the grid via the records fold) and bench
 * the apply round trip over the real Electron MessagePort lane.
 */
export function SkeletonPanel() {
  const [status, setStatus] = useState("idle");
  const [layerId, setLayerId] = useState<LayerId | null>(null);

  if (!isDev) return null;

  const addGlyph = async () => {
    const name = `skeleton${Date.now() % 100000}`;
    const start = performance.now();

    const applied = await getWorkspace().apply(
      [{ kind: "createGlyph", name, unicodes: [] }],
      "Add Glyph",
    );

    const ms = performance.now() - start;
    setLayerId(applied.layers[0]?.layerId ?? null);
    setStatus(`createGlyph "${name}" in ${ms.toFixed(2)}ms`);
  };

  const drawContour = async () => {
    if (!layerId) {
      setStatus("add a glyph first");
      return;
    }

    const contourId = mintContourId();
    const start = performance.now();

    await getWorkspace().apply(
      [
        { kind: "addContour", addContour: { layerId, contourId, closed: false } },
        {
          kind: "addPoints",
          addPoints: {
            layerId,
            contourId,
            points: [
              { id: mintPointId(), x: 50, y: 50, pointType: "onCurve" as PointType, smooth: false },
              {
                id: mintPointId(),
                x: 450,
                y: 50,
                pointType: "onCurve" as PointType,
                smooth: false,
              },
              {
                id: mintPointId(),
                x: 250,
                y: 600,
                pointType: "onCurve" as PointType,
                smooth: false,
              },
            ],
          },
        },
        { kind: "setContourClosed", setContourClosed: { layerId, contourId, closed: true } },
      ],
      "Draw Contour",
    );

    setStatus(`drew a triangle in ${(performance.now() - start).toFixed(2)}ms (one undo step)`);
  };

  const undo = async () => {
    const applied = await getWorkspace().undo();
    setStatus(
      applied === null
        ? "nothing to undo"
        : `undone: ${applied.layers[0]?.structure?.contours.length ?? 0} contours remain`,
    );
  };

  const redo = async () => {
    const applied = await getWorkspace().redo();
    setStatus(
      applied === null
        ? "nothing to redo"
        : `redone: ${applied.layers[0]?.structure?.contours.length ?? 0} contours now`,
    );
  };

  const bench = async () => {
    if (!layerId) {
      setStatus("add a glyph first");
      return;
    }

    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await getWorkspace().apply([{ kind: "setXAdvance", layerId, width: 500 + i }]);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const line = `apply ×100: p50=${samples[49].toFixed(2)}ms p99=${samples[98].toFixed(2)}ms`;
    console.info(`[CS0] ${line}`);
    setStatus(line);
  };

  return (
    <div className="absolute bottom-4 right-4 z-[100] flex flex-col gap-1 border border-app/5 bg-surface p-2 text-ui shadow-md">
      <span className="font-medium text-primary">CS0 skeleton</span>
      <div className="flex gap-2">
        <button
          className="border px-2 py-0.5 hover:bg-line-subtle"
          onClick={() => void addGlyph().catch((error) => setStatus(String(error)))}
        >
          add glyph
        </button>
        <button
          className="border px-2 py-0.5 hover:bg-line-subtle"
          onClick={() => void bench().catch((error) => setStatus(String(error)))}
        >
          bench ×100
        </button>
        <button
          className="border px-2 py-0.5 hover:bg-line-subtle"
          onClick={() => void drawContour().catch((error) => setStatus(String(error)))}
        >
          draw
        </button>
        <button
          className="border px-2 py-0.5 hover:bg-line-subtle"
          onClick={() => void undo().catch((error) => setStatus(String(error)))}
        >
          undo
        </button>
        <button
          className="border px-2 py-0.5 hover:bg-line-subtle"
          onClick={() => void redo().catch((error) => setStatus(String(error)))}
        >
          redo
        </button>
      </div>
      <span className="font-mono tabular-nums text-muted">{status}</span>
    </div>
  );
}
