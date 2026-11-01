import { bench, describe } from "vitest";
import { mintRunId } from "@shift/types";
import type { TextRunNode } from "@shift/editor/types";
import { SceneNodes } from "@shift/editor";
import { TestEditor } from "@/testing/TestEditor";
import { proofText } from "@/testing/proofText";

/**
 * What the scene costs now that it lives in the window's engine.
 *
 * - **move a run, one staged frame** stages one text run's new position in an
 *   edit open across frames, as a drag does each frame, and reads the shown
 *   page's nodes back.
 * - **one scene edit** moves a run as one edit: the engine applies it, the
 *   editor reads the scene back, and the change set is queued to persist.
 * - **reopen the engine** opens the window's engine over the store, reading
 *   the whole scene, and reads its nodes, as opening a document does.
 *
 * The scene holds `SHIFT_BENCH_SCENE_RUNS` text runs (500 by default) of 40
 * characters each, on two pages.
 */

const RUNS = Number(process.env.SHIFT_BENCH_SCENE_RUNS ?? 500);
const OPTIONS = { time: 0, iterations: 60, warmupTime: 0, warmupIterations: 5 };

/** A document whose scene holds `RUNS` text runs on two pages, made as one edit. */
async function largeScene(): Promise<{
  editor: TestEditor;
  run: TextRunNode;
  items: ReturnType<TestEditor["text"]["itemsFromText"]>;
}> {
  const editor = await new TestEditor().startSession();
  const pages = [editor.pages.create("Proofs"), editor.pages.create("Specimen")];
  const items = editor.text.itemsFromText(proofText(40));
  const runs = editor.font.editCoordinator.transaction("Bench scene", () =>
    Array.from({ length: RUNS }, (_, index) =>
      editor.scene.createNode<TextRunNode>(
        {
          kind: "textRun",
          parentId: pages[index % 2]!.id,
          runId: mintRunId(),
          size: 1000,
          position: { x: 0, y: index * 1200 },
        },
        items,
      ),
    ),
  );
  await editor.settle();
  editor.pages.activate(pages[0]!.id);
  return { editor, run: runs[0]!, items };
}

describe(`a scene of ${RUNS.toLocaleString("en-US")} text runs`, () => {
  let scene: ReturnType<typeof largeScene> | null = null;
  const open = () => (scene ??= largeScene());

  let frame = 0;
  bench(
    "move a run, one staged frame",
    async () => {
      const { editor, run } = await open();
      const edit = editor.font.editCoordinator.openEdit();
      frame += 1;
      // The run's node at a new place, as the editor writes an update: its
      // own items and settings, which the scene keeps.
      const moved = { ...run, position: { x: frame, y: 0 } };
      const updateNode = SceneNodes.toDocument(moved, editor.scene.run(run.runId));
      edit.stageScene([{ kind: "updateNode", updateNode }]);
      if (editor.scene.nodes().length === 0) throw new Error("the page shows nothing");
      edit.cancel();
    },
    { ...OPTIONS, setup: async () => void (await open()) },
  );

  bench(
    "one scene edit",
    async () => {
      const { editor, run } = await open();
      frame += 1;
      editor.scene.updateNode({ id: run.id, position: { x: frame, y: 0 } });
      if (editor.scene.node(run.id)?.position.x !== frame) throw new Error("the run did not move");
    },
    { ...OPTIONS, setup: async () => void (await open()) },
  );

  bench(
    "reopen the engine and read the scene",
    async () => {
      const { editor } = await open();
      await editor.settle();
      await editor.workspaceEditCoordinator.reopenEngine();
      if (editor.scene.allNodes().length < RUNS) throw new Error("the scene did not come back");
    },
    { ...OPTIONS, iterations: 10, setup: async () => void (await open()) },
  );
});
