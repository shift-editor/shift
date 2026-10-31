import { bench, describe } from "vitest";
import { loadEngine } from "@shift/editor/model";
import { createWorkspaceStack } from "@/testing/workspaceStack";
import { engineStoreRequest } from "@/lib/engine/engineStoreRequest";
import { layerReaderHost } from "../../../preload/layerReaders";

/**
 * Opening a large document in the window once its store exists: the
 * workspace's stored snapshot, the window's engine opened over the store
 * with the font records it reads, and both together as the window opens a
 * document. Imports `SHIFT_BENCH_OPEN_FONT` (for example Arial Unicode) once,
 * then times each step on the store that import left; skipped without it.
 */
const FONT = process.env.SHIFT_BENCH_OPEN_FONT;
const OPTIONS = { time: 0, iterations: 10, warmupTime: 0, warmupIterations: 2 };

describe.skipIf(!FONT)("opening a large document", async () => {
  const stack = createWorkspaceStack();
  if (FONT) await stack.openWorkspace(FONT);
  const { EngineSession } = await loadEngine();
  const layers = layerReaderHost();

  bench(
    "the workspace's stored snapshot",
    async () => {
      await stack.client.snapshot();
    },
    OPTIONS,
  );

  bench(
    "the engine opened over the store, and its font records",
    async () => {
      const [location, directory] = await Promise.all([
        stack.client.storeLocation(),
        stack.client.directory(),
      ]);
      if (!location || !directory) throw new Error("the document has no store");
      const reader = layers.open(location);
      const session = EngineSession.open(
        directory,
        engineStoreRequest(layers, () => reader),
      );
      session.fontRecords();
      session.dispose();
      layers.close(reader);
    },
    OPTIONS,
  );

  bench(
    "the window opening the document (snapshot, engine, records shown)",
    async () => {
      await stack.editCoordinator.open(await stack.client.snapshot());
    },
    OPTIONS,
  );
});
