import { useState } from "react";
import type { LayerId } from "@shift/types";
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
      </div>
      <span className="font-mono tabular-nums text-muted">{status}</span>
    </div>
  );
}
