/**
 * Frame cost of a long proof run in the real app: hovering its glyphs, and
 * dragging an anchor of the glyph edited in place.
 *
 * The run is about 10K characters of lorem in `AnchorDragBench`, with every
 * 4th letter `ǖ` and every 13th another composite on `u`, typed through the
 * Text tool's native input. Each sample is one real pointer move, then:
 *
 * - **work**: main-thread time in the animation frames that handle the move
 *   (hit testing, preview, and every render pass), without waiting for vsync.
 * - **frame**: main-thread time of the move's heaviest frame, from its first
 *   animation-frame callback until the browser has painted it and committed
 *   it to the compositor, which is where the canvas's draw calls are flushed
 *   to the GPU process. A frame over the display's interval drops a frame.
 *
 * Time until the first idle frame is not a measure here: it counts the
 * animation frames a move chains through (pointer, render, then UI updates),
 * each a whole vsync, so it barely changes between 10 and 10K characters.
 *
 * Reports go to `perf-results/` beside the other perf specs. Ceilings are
 * provisional and generous; they catch a run that stops being interactive.
 */
import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import type { LocalPoint, ScenePoint } from "@shift/editor/spaces";
import type { Point2D } from "@shift/geo";
import type { GlyphName, TextItemId } from "@shift/types";
import { proofText } from "../src/renderer/src/testing/proofText";
import type { EditorDriver } from "./fixtures/EditorDriver";
import {
  anchorDragTest as test,
  computeStats,
  expect,
  formatPerfTable,
  type PerfResult,
} from "./fixtures/perfApp";

const RESULTS_DIR = path.resolve(__dirname, "perf-results");
const TEXT_LENGTH = 10_000;
const HOVER_FRAMES = 40;
const DRAG_FRAMES = 60;

/** Provisional p95 ceilings (ms) per measurement. */
const CEILINGS: Record<string, number> = {
  "text run hover work (10K chars)": 1_000,
  "text run hover frame (10K chars)": 1_000,
  "text run drag u.top work (10K chars)": 250,
  "text run drag u.top frame (10K chars)": 250,
};

interface FrameSample {
  work: number;
  frame: number;
}

declare global {
  interface Window {
    __shiftFrameProbe?: {
      /** Start time and duration of every animation-frame callback since install. */
      callbacks: { start: number; duration: number }[];
      /** The latest pointer move: its time, its frames' start and end, and its first idle frame. */
      move: {
        at: number;
        frameStarts: number[];
        frameEnds: number[];
        settledAt: number | null;
      } | null;
    };
  }
}

/**
 * Times every animation-frame callback and stamps each pointer move.
 *
 * @remarks
 * The editor coalesces pointer moves into an animation frame and redraws in
 * the frame after, so animation-frame callbacks hold the hit test, the
 * preview, and every render pass. After a move the probe ticks once per
 * frame, unwrapped, and stops at the first frame in which no other callback
 * ran since its last tick, so samples do not overlap.
 *
 * Each tick is the first callback of its frame, because it is requested
 * before any callback for that frame. It posts a message, which runs as the
 * next task, after the frame's style, layout, paint, and commit, so the gap
 * from tick to message is the frame's main-thread time.
 */
async function installFrameProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const request = window.requestAnimationFrame.bind(window);
    const probe: NonNullable<Window["__shiftFrameProbe"]> = { callbacks: [], move: null };
    window.__shiftFrameProbe = probe;
    window.requestAnimationFrame = (callback) =>
      request((time) => {
        const start = performance.now();
        try {
          callback(time);
        } finally {
          probe.callbacks.push({ start, duration: performance.now() - start });
        }
      });
    window.addEventListener(
      "pointermove",
      () => {
        const move = {
          at: performance.now(),
          frameStarts: [] as number[],
          frameEnds: [] as number[],
          settledAt: null as number | null,
        };
        probe.move = move;
        const frameEnd = new MessageChannel();
        frameEnd.port1.onmessage = ({ data }: MessageEvent<number>) => {
          move.frameEnds[data] = performance.now();
        };
        let last = move.at;
        let ticks = 0;
        const tick = () => {
          const now = performance.now();
          frameEnd.port2.postMessage(move.frameStarts.length);
          move.frameStarts.push(now);
          const busy = probe.callbacks.some(({ start }) => start >= last && start < now);
          last = now;
          ticks++;
          // Two ticks at least: the move is handled in the first frame, drawn in the next.
          if ((ticks >= 2 && !busy) || ticks >= 10) {
            move.settledAt = now;
            return;
          }
          request(tick);
        };
        request(tick);
      },
      { capture: true },
    );
  });
}

/**
 * Moves the real pointer and times the frames that handle it.
 *
 * @returns `work`, the summed animation-frame callbacks from the move until the
 * first idle frame after it; `frame`, the main-thread time of the heaviest
 * frame in that span, including its rendering and commit.
 */
async function measureMove(page: Page, position: Point2D): Promise<FrameSample> {
  await page.evaluate(() => {
    window.__shiftFrameProbe!.move = null;
  });
  await page.mouse.move(position.x, position.y);
  // Poll on a timer: polling on animation frames would keep the probe from seeing an idle frame.
  await page.waitForFunction(
    () => {
      const move = window.__shiftFrameProbe?.move;
      return move?.settledAt != null && move.frameEnds.length === move.frameStarts.length;
    },
    null,
    { polling: 10 },
  );
  return page.evaluate(() => {
    const probe = window.__shiftFrameProbe!;
    const { at, settledAt, frameStarts, frameEnds } = probe.move!;
    const work = probe.callbacks
      .filter((callback) => callback.start >= at && callback.start < settledAt!)
      .reduce((total, callback) => total + callback.duration, 0);
    const frame = Math.max(...frameStarts.map((start, index) => frameEnds[index]! - start));
    probe.callbacks = [];
    return { work, frame };
  });
}

/** Live position of the `u` glyph's `top` anchor in its default-source layer. */
async function uTop(page: Page): Promise<Point2D> {
  return page.evaluate(() => {
    const editor = window.shift!.editor;
    const record = editor.font.recordForName("u" as GlyphName);
    const layer = record
      ? editor.glyphForId(record.id)?.layerForSource(editor.font.defaultSource.id)
      : null;
    const anchor = layer?.anchors.find((candidate) => candidate.name === "top");
    if (!anchor) throw new Error("Expected u's top anchor");

    return { x: anchor.x, y: anchor.y };
  });
}

/** Page positions over run glyphs on the canvas, other than the edited one, with their items. */
async function hoverTargets(
  page: Page,
  editor: EditorDriver,
): Promise<{ itemId: TextItemId; position: Point2D }[]> {
  const bounds = await editor.canvasBounds();
  const targets = await page.evaluate((size) => {
    const editor = window.shift!.editor;
    const run = editor.scene.nodesOfKind("textRun")[0];
    const layout = run ? editor.text.layoutCell(run.runId).peek() : null;
    if (!run || !layout) throw new Error("Expected the canvas run");

    const found: { itemId: TextItemId; position: Point2D }[] = [];
    for (const placed of layout.placedGlyphs.slice(1, 40)) {
      // Between the bowl's outer and inner rings, inside every letter's fill.
      const local = { x: placed.left + placed.glyph.xAdvance / 2, y: 35 } as LocalPoint;
      const scene = editor.toScene(run, local);
      const target = editor.getPointerTarget(scene as ScenePoint);
      const screen = editor.sceneToScreen(scene);
      const onCanvas =
        screen.x > 0 && screen.y > 0 && screen.x < size.width && screen.y < size.height;
      if (target.kind === "text" && onCanvas)
        found.push({ itemId: target.itemId, position: screen });
    }
    return found;
  }, bounds);

  return targets.map(({ itemId, position }) => ({
    itemId,
    position: { x: bounds.x + position.x, y: bounds.y + position.y },
  }));
}

test.describe("Performance — 10K-character text run", () => {
  const results: PerfResult[] = [];

  test.afterAll(() => {
    if (results.length === 0) return;

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const table = formatPerfTable(results);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(RESULTS_DIR, `text-run-perf-${timestamp}.md`);
    const report = [
      `# Text Run Perf Report — ${new Date().toISOString()}`,
      "",
      `**Text:** ${TEXT_LENGTH.toLocaleString("en-US")} characters of ǖ-heavy lorem`,
      `**Hover frames:** ${HOVER_FRAMES}`,
      `**Drag frames:** ${DRAG_FRAMES}`,
      "",
      table,
      "",
    ].join("\n");

    fs.writeFileSync(reportPath, report);
    console.log(`\nPerf report written to: ${reportPath}`);
    console.log(table);
  });

  function record(label: string, samples: number[]): void {
    const stats = computeStats(label, samples);
    results.push(stats);
    console.log(`${label}: p50=${stats.p50.toFixed(2)}ms p95=${stats.p95.toFixed(2)}ms`);

    const ceiling = CEILINGS[label];
    if (ceiling === undefined) throw new Error(`No ceiling for ${label}`);
    expect(
      stats.p95,
      `${label}: p95 (${stats.p95.toFixed(2)}ms) exceeds ceiling (${ceiling}ms)`,
    ).toBeLessThanOrEqual(ceiling);
  }

  test("hovers run glyphs and drags u's top anchor", async ({ page, editor }) => {
    test.setTimeout(240_000);
    await editor.openGlyphByUnicode("75");

    const text = proofText(TEXT_LENGTH);
    await editor.selectTool("text");
    await expect(page.getByRole("textbox", { name: "Text input" })).toBeFocused();
    await page.keyboard.insertText(text);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const editor = window.shift!.editor;
            const run = editor.scene.nodesOfKind("textRun")[0];
            const items = run ? editor.text.run(run.runId)?.items : null;
            const layout = run ? editor.text.layoutCell(run.runId).peek() : null;
            const loaded = layout?.placedGlyphs.every(
              (placed) => placed.glyph.glyphId && editor.glyphForId(placed.glyph.glyphId),
            );
            return items && loaded ? items.length : null;
          }),
        { timeout: 60_000 },
      )
      .toBe(1 + [...text].length);

    await editor.press("Escape");
    await expect
      .poll(() => page.evaluate(() => window.shift!.editor.editing.nodeIds.length))
      .toBe(1);
    await page.evaluate(() => window.shift!.editor.setZoom(window.shift!.editor.zoom * 0.5));
    await editor.waitForCanvasRender();

    // Hover: each move lands on another run glyph, so each frame redraws its outline.
    const targets = await hoverTargets(page, editor);
    await installFrameProbe(page);
    expect(targets.length, "run glyphs on the canvas to hover").toBeGreaterThanOrEqual(2);
    const hoverWork: number[] = [];
    const hoverFrame: number[] = [];
    for (let frame = 0; frame < HOVER_FRAMES; frame++) {
      const target = targets[frame % targets.length]!;
      const sample = await measureMove(page, target.position);
      expect(await editor.hoverId()).toBe(target.itemId);
      hoverWork.push(sample.work);
      hoverFrame.push(sample.frame);
    }

    // Drag: press on the anchor, start the drag, then time each move.
    const before = await uTop(page);
    const from = await editor.projectGlyphToPage(before);
    await editor.pointerDown(from);
    await editor.pointerMove({ x: from.x + 6, y: from.y - 3 });
    await expect.poll(() => editor.toolState()).toBe("translating");

    const dragWork: number[] = [];
    const dragFrame: number[] = [];
    for (let frame = 0; frame < DRAG_FRAMES; frame++) {
      const sample = await measureMove(page, {
        x: from.x + 8 + frame * 2,
        y: from.y - 4 - (frame % 7),
      });
      dragWork.push(sample.work);
      dragFrame.push(sample.frame);
    }
    const dragged = await uTop(page);
    expect(dragged.x).toBeGreaterThan(before.x);

    await editor.pointerUp();
    expect(await uTop(page)).toEqual(dragged);
    await editor.undo();
    expect(await uTop(page)).toEqual(before);

    record("text run hover work (10K chars)", hoverWork);
    record("text run hover frame (10K chars)", hoverFrame);
    record("text run drag u.top work (10K chars)", dragWork);
    record("text run drag u.top frame (10K chars)", dragFrame);
  });
});
