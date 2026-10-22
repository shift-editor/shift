import { resolve } from "node:path";
import { bench, describe } from "vitest";
import { Bounds } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type { FrameNode, TextRunNode } from "@shift/editor/types";
import { scenePoint } from "@shift/editor/spaces";
import { batch } from "@shift/editor/signals";
import { TestEditor } from "@/testing/TestEditor";
import { flushFrames, stubSurfaces } from "./benchHarness";

/**
 * Cost of interacting with a page of auto layout frames, per frame.
 *
 * @remarks
 * Real editor and renderer effects drawing into stub 2D contexts, with
 * animation frames run by hand so each iteration's layout and redraw happen
 * inside the timed function. The page is a grid of column frames, each
 * holding 10 row frames of 10 short text runs, in
 * `fixtures/fonts/AnchorDragBench.glyphs`. Smooth means every scenario
 * stays well under a 60 Hz frame (16.7 ms) at 10K runs.
 *
 * - **drag a frame** moves the first column by a pixel through the Select tool.
 * - **pan zoomed out** pans by a pixel with the whole page in view, so every run draws.
 * - **resize a frame** drags the first column's right edge by a pixel.
 * - **edit a run** adds a character to one run inside a frame and reshapes it.
 * - **lay out a frame** changes one column's gap and reads where it put its last run, without drawing.
 *
 * Not run by `pnpm test:perf`; run it by hand with
 * `SHIFT_BENCH_FRAMES=1000,10000 pnpm --filter @shift/desktop exec vitest bench --run frames`.
 */

const FONT = resolve(process.cwd(), "../../fixtures/fonts/AnchorDragBench.glyphs");
const SCALES = (process.env.SHIFT_BENCH_FRAMES ?? "")
  .split(",")
  .filter((scale) => scale.trim() !== "")
  .map((scale) => Number(scale.trim()));
const OPTIONS = { time: 0, iterations: 30, warmupTime: 0, warmupIterations: 3 };

const RUNS_PER_ROW = 10;
const ROWS_PER_COLUMN = 10;
const RUNS_PER_COLUMN = RUNS_PER_ROW * ROWS_PER_COLUMN;
const COLUMNS_PER_ROW_OF_PAGE = 10;
/** Wide enough at the bench's zoom to press inside a frame without hitting a child or a handle. */
const PADDING = 160;
const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "magna", "aliqua", "veniam"];

interface Page {
  editor: TestEditor;
  columns: readonly FrameNode[];
  runs: readonly TextRunNode[];
}

/** Opens the fixture and fills the active page with `count` runs in frames. */
async function openPage(count: number): Promise<Page> {
  const editor = await new TestEditor().openSession(FONT, "u");
  for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  editor.history.withoutRecording(() => editor.exitNodes());

  const columns: FrameNode[] = [];
  const runs: TextRunNode[] = [];
  editor.history.withoutRecording(() =>
    batch(() => {
      for (let column = 0; column < count / RUNS_PER_COLUMN; column++) {
        const frame = createFrame(editor, null, {
          position: {
            x: (column % COLUMNS_PER_ROW_OF_PAGE) * 8000,
            y: Math.floor(column / COLUMNS_PER_ROW_OF_PAGE) * 12000,
          },
          layout: { mode: "column", padding: uniform(PADDING) },
        });
        columns.push(frame);
        for (let row = 0; row < ROWS_PER_COLUMN; row++) {
          const rowFrame = createFrame(editor, frame.id, { layout: { mode: "row", gap: 24 } });
          for (let index = 0; index < RUNS_PER_ROW; index++) {
            const word = WORDS[(column + row + index) % WORDS.length]!;
            const run = editor.frames.addText(rowFrame.id, `${word} ${index}`, { size: 48 });
            if (!run) throw new Error("could not add a run");
            runs.push(run);
          }
        }
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
  const placed = [...columns, ...runs].filter((node) => editor.frames.laidOut(node.id));
  if (placed.length !== columns.length + runs.length) {
    throw new Error("the page did not lay out every frame and run");
  }

  editor.selectTool("select");
  return { editor, columns, runs };
}

function createFrame(
  editor: TestEditor,
  parentId: NodeId | null,
  options: Parameters<TestEditor["frames"]["create"]>[1],
): FrameNode {
  const frame = editor.frames.create(parentId, options);
  if (!frame) throw new Error("could not add a frame");
  return frame;
}

function uniform(size: number) {
  return { top: size, right: size, bottom: size, left: size };
}

/** The frame's laid-out box in scene units. */
function sceneRect(editor: TestEditor, frameId: NodeId) {
  const frame = editor.scene.nodeOfKind(frameId, "frame")!;
  return Bounds.toRect(editor.nodeBounds(frame)!);
}

/** Selects `frameId`, fits it in view, and presses at `pick` (in its scene box). */
function pressOnFrame(
  editor: TestEditor,
  frameId: NodeId,
  pick: (rect: ReturnType<typeof sceneRect>) => { x: number; y: number },
): { x: number; y: number } {
  editor.selection.select([frameId]);
  editor.zoomToSelection();
  flushFrames();
  const point = pick(sceneRect(editor, frameId));
  const screen = editor.sceneToScreen(scenePoint(point.x, point.y));
  editor.pointerDown(screen.x, screen.y);
  // Past the drag threshold, so every timed move previews.
  editor.pointerMove(screen.x + 6, screen.y);
  flushFrames();
  return { x: screen.x + 6, y: screen.y };
}

if (SCALES.length === 0) {
  describe.skip("frames (set SHIFT_BENCH_FRAMES to run)", () => {
    bench("skipped", () => {});
  });
}

for (const scale of SCALES) {
  describe(`frames, ${scale.toLocaleString("en-US")} text runs`, () => {
    let page: Promise<Page> | null = null;
    const open = () => (page ??= openPage(scale));
    // Tinybench does not await `teardown`, so each setup waits for the last one's cleanup.
    let cleanup: Promise<void> = Promise.resolve();
    const ready = async () => {
      await cleanup;
      return open();
    };

    let dragFrom = { x: 0, y: 0 };
    let dragStep = 0;
    let dragStart = { x: 0, y: 0 };
    bench(
      "drag a frame",
      async () => {
        const { editor } = await open();
        dragStep++;
        editor.pointerMove(dragFrom.x + dragStep, dragFrom.y);
        if (flushFrames() === 0) throw new Error("dragging did not redraw");
      },
      {
        ...OPTIONS,
        setup: async () => {
          const { editor, columns } = await ready();
          const column = columns[0]!;
          dragStart = column.position;
          dragStep = 0;
          dragFrom = pressOnFrame(editor, column.id, (rect) => ({
            x: rect.x + PADDING / 2,
            y: rect.y + PADDING / 2,
          }));
        },
        teardown: () => {
          cleanup = (async () => {
            const { editor, columns } = await open();
            editor.pointerUp(dragFrom.x + dragStep, dragFrom.y);
            await editor.settle();
            const moved = editor.scene.nodeOfKind(columns[0]!.id, "frame")!.position;
            if (moved.x === dragStart.x) throw new Error("the frame did not move");
            await editor.undo();
            flushFrames();
          })();
        },
      },
    );

    let panStep = 0;
    bench(
      "pan zoomed out",
      async () => {
        const { editor } = await open();
        const pan = editor.camera.panCell.peek();
        editor.setPan({ x: pan.x + (panStep++ % 2 ? 1 : -1), y: pan.y });
        if (flushFrames() === 0) throw new Error("panning did not redraw");
      },
      {
        ...OPTIONS,
        setup: async () => {
          const { editor } = await ready();
          editor.selection.clear();
          editor.zoomToFit();
          flushFrames();
        },
      },
    );

    let resizeFrom = { x: 0, y: 0 };
    let resizeStep = 0;
    bench(
      "resize a frame",
      async () => {
        const { editor } = await open();
        resizeStep++;
        editor.pointerMove(resizeFrom.x + resizeStep, resizeFrom.y);
        if (flushFrames() === 0) throw new Error("resizing did not redraw");
      },
      {
        ...OPTIONS,
        setup: async () => {
          const { editor, columns } = await ready();
          resizeStep = 0;
          resizeFrom = pressOnFrame(editor, columns[0]!.id, (rect) => ({
            x: rect.right,
            y: rect.y + rect.height / 2,
          }));
        },
        teardown: () => {
          cleanup = (async () => {
            const { editor, columns } = await open();
            editor.pointerUp(resizeFrom.x + resizeStep, resizeFrom.y);
            await editor.settle();
            if (editor.scene.nodeOfKind(columns[0]!.id, "frame")!.width.kind !== "fixed") {
              throw new Error("the frame did not resize");
            }
            await editor.undo();
            flushFrames();
          })();
        },
      },
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
        setup: async () => {
          await ready();
        },
      },
    );

    let gap = 0;
    bench(
      "lay out a frame",
      async () => {
        const { editor, columns, runs } = await open();
        const column = columns[0]!;
        editor.history.withoutRecording(() =>
          editor.scene.updateNode({ id: column.id, layout: { ...column.layout, gap: gap++ % 40 } }),
        );
        if (!editor.frames.laidOut(runs[RUNS_PER_COLUMN - 1]!.id)) {
          throw new Error("nothing was laid out");
        }
      },
      {
        ...OPTIONS,
        setup: async () => {
          await ready();
        },
        teardown: (_task, mode) => {
          if (mode !== "run") return;
          cleanup = open().then(({ editor }) => editor.closeSession());
        },
      },
    );
  });
}
