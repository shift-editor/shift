import { resolve } from "node:path";
import { bench, describe } from "vitest";
import type { TextRunNode } from "@shift/editor/types";
import { batch } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";
import { flushFrames, stubSurfaces } from "./benchHarness";

/**
 * Cost of interacting with a page of many text runs, per frame.
 *
 * @remarks
 * Real editor and renderer effects drawing into stub 2D contexts, with
 * animation frames run by hand so each iteration's redraw happens inside the
 * timed function. The page is a grid of short text runs placed directly on
 * it, in `fixtures/fonts/AnchorDragBench.glyphs`. Smooth means every
 * scenario stays well under a 60 Hz frame (16.7 ms) at 10K runs.
 *
 * - **pan zoomed out** pans by a pixel with the whole page in view, so every run draws.
 * - **move a run** moves one run by a unit through the scene, zoomed in on it, and redraws.
 * - **edit a run** adds a character to one run, zoomed in on it, and reshapes it.
 *
 * Not run by `pnpm test:perf`; run it by hand with
 * `SHIFT_BENCH_SCENE=1000,10000 pnpm --filter @shift/desktop exec vitest bench --run scene`.
 */

const FONT = resolve(process.cwd(), "../../fixtures/fonts/AnchorDragBench.glyphs");
const SCALES = (process.env.SHIFT_BENCH_SCENE ?? "")
  .split(",")
  .filter((scale) => scale.trim() !== "")
  .map((scale) => Number(scale.trim()));
const OPTIONS = { time: 0, iterations: 30, warmupTime: 0, warmupIterations: 3 };

const RUNS_PER_ROW = 100;
const COLUMN_WIDTH = 800;
const ROW_HEIGHT = 120;
const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "magna", "aliqua", "veniam"];

interface Page {
  editor: TestEditor;
  runs: readonly TextRunNode[];
}

/** Opens the fixture and fills the active page with `count` runs in a grid. */
async function openPage(count: number): Promise<Page> {
  const editor = await new TestEditor().openSession(FONT, "u");
  for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  editor.history.withoutRecording(() => editor.exitNodes());

  const runs: TextRunNode[] = [];
  editor.history.withoutRecording(() =>
    batch(() => {
      for (let index = 0; index < count; index++) {
        const word = WORDS[index % WORDS.length]!;
        const run = editor.text.createRun(editor.text.itemsFromText(`${word} ${index % 100}`));
        runs.push(
          editor.scene.createNode<TextRunNode>({
            kind: "textRun",
            runId: run.id,
            size: 48,
            position: {
              x: (index % RUNS_PER_ROW) * COLUMN_WIDTH,
              y: Math.floor(index / RUNS_PER_ROW) * ROW_HEIGHT,
            },
          }),
        );
      }
    }),
  );

  // The canvas size, as the app sets it from the canvas element, so the camera knows what is on screen.
  editor.setCameraRect({
    x: 0,
    y: 0,
    width: 1000,
    height: 800,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 800,
  });
  const surfaces = stubSurfaces();
  editor.attachRenderSurfaces(
    surfaces.background as never,
    surfaces.scene as never,
    surfaces.overlay as never,
    surfaces.markers as never,
  );
  await editor.settle();
  flushFrames();
  const laidOut = runs.filter((run) => editor.text.layoutCell(run.runId).peek());
  if (laidOut.length !== runs.length) throw new Error("the page did not lay out every run");

  editor.selectTool("select");
  return { editor, runs };
}

if (SCALES.length === 0) {
  describe.skip("scene (set SHIFT_BENCH_SCENE to run)", () => {
    bench("skipped", () => {});
  });
}

for (const scale of SCALES) {
  describe(`scene, ${scale.toLocaleString("en-US")} text runs`, () => {
    let page: Promise<Page> | null = null;
    const open = () => (page ??= openPage(scale));
    // Tinybench does not await `teardown`, so each setup waits for the last one's cleanup.
    let cleanup: Promise<void> = Promise.resolve();
    const ready = async () => {
      await cleanup;
      return open();
    };
    const zoomedOut = async () => {
      const { editor } = await ready();
      editor.selection.clear();
      editor.zoomToFit();
      flushFrames();
    };
    const zoomedIn = async () => {
      const { editor, runs } = await ready();
      editor.selection.select([runs[0]!.id]);
      editor.zoomToSelection();
      editor.selection.clear();
      flushFrames();
    };

    let panStep = 0;
    bench(
      "pan zoomed out",
      async () => {
        const { editor } = await open();
        const pan = editor.camera.panCell.peek();
        editor.setPan({ x: pan.x + (panStep++ % 2 ? 1 : -1), y: pan.y });
        if (flushFrames() === 0) throw new Error("panning did not redraw");
      },
      { ...OPTIONS, setup: zoomedOut },
    );

    let moves = 0;
    bench(
      "move a run",
      async () => {
        const { editor, runs } = await open();
        const run = runs[0]!;
        editor.history.withoutRecording(() =>
          editor.scene.updateNode({ id: run.id, position: { x: moves++ % 40, y: 0 } }),
        );
        if (flushFrames() === 0) throw new Error("moving did not redraw");
      },
      { ...OPTIONS, setup: zoomedIn },
    );

    let edits = 0;
    bench(
      "edit a run",
      async () => {
        const { editor, runs } = await open();
        const run = runs[0]!;
        const items = editor.text.run(run.runId)!.items;
        editor.text.setItems(run.runId, [
          ...items,
          ...editor.text.itemsFromText(edits++ % 2 ? "a" : "u"),
        ]);
        await editor.settle();
        if (flushFrames() === 0) throw new Error("editing did not redraw");
      },
      {
        ...OPTIONS,
        setup: zoomedIn,
        teardown: (_task, mode) => {
          if (mode !== "run") return;
          cleanup = open().then(({ editor }) => editor.closeSession());
        },
      },
    );
  });
}
