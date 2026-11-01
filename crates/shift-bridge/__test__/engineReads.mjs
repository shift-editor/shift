import { engineOpen, engineReads, engineRelease, initEngine } from "@shift/wasm/engine";

// The engine compiles its module once before any call, as the SDK's consumers await it.
await initEngine();

/**
 * The open workspace's font records as the window's engine reads them: the
 * native workspace no longer serves its axes, sources or kerning. Only reads
 * run, so the engine never asks the store for a layer.
 */
export function engineFontRecords(bridge) {
  const handle = engineOpen(bridge.workspace.encodedDirectory(), () => {
    throw new Error("a font-record read loads no layers");
  });
  try {
    const reads = engineReads(handle);
    return { axes: reads.axes(), sources: reads.sources(), kerning: reads.kerning() };
  } finally {
    engineRelease(handle);
  }
}
