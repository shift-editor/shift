/**
 * Perf instrumentation for the perf specs: everything that measures the running app rather than
 * reading its state. Reads go through `EditorDriver`, setup edits through `fontSetup.ts`.
 *
 * Frame timing ({@link installFrameProbe}, {@link measureMove}) times the main-thread frames
 * that handle each real pointer move:
 *
 * - **work**: main-thread time in the animation frames that handle the move
 *   (hit testing, preview, and every render pass), without waiting for vsync.
 * - **frame**: main-thread time of the move's heaviest frame, from its first
 *   animation-frame callback until the browser has painted it and committed
 *   it to the compositor. A frame over the display's interval drops a frame.
 *
 * The in-page benchmarks (`measure*`, {@link timeContourInsertion}) time one editor operation
 * per sample with `performance.now()` inside the page, so Playwright round trips are not part of
 * the sample. React render counts live in `renderCounter.mts`, which `profile-desktop.mjs`
 * shares.
 */
import type { Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { generateContourData } from "./perfApp";
import { hooksOf } from "./appHooks";

export interface FrameSample {
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
export async function installFrameProbe(page: Page): Promise<void> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- measures frame timing in the page, not app state
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
export async function measureMove(page: Page, position: Point2D): Promise<FrameSample> {
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- measures frame timing in the page, not app state
  await page.evaluate(() => {
    window.__shiftFrameProbe!.move = null;
  });
  await page.mouse.move(position.x, position.y);
  // Poll on a timer: polling on animation frames would keep the probe from seeing an idle frame.
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- measures frame timing in the page, not app state
  await page.waitForFunction(
    () => {
      const move = window.__shiftFrameProbe?.move;
      return move?.settledAt != null && move.frameEnds.length === move.frameStarts.length;
    },
    null,
    { polling: 10 },
  );
  // oxlint-disable-next-line shift/no-page-evaluate-in-specs -- measures frame timing in the page, not app state
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

/** Generated benchmark contours, as {@link generateContourData} returns them. */
export type PerfContours = ReturnType<typeof generateContourData>;

/** Samples from an in-page benchmark, in milliseconds, one per timed frame. */
export type Samples = number[];

/**
 * Pastes `contours` into the open glyph in one `insertContent` call and times it in the page.
 *
 * @returns how many objects it inserted, the last one's id, and the call's duration.
 */
export async function timeContourInsertion(
  page: Page,
  contours: PerfContours,
): Promise<{ count: number; lastId: string | undefined; ms: number }> {
  return hooksOf(page).perf.timeContourInsertion(contours);
}

/**
 * Pastes `contours`, selects all, and times the layer's preview position patch for the first
 * `count` selected points (all when null), moving them one unit per frame from `origin`, after
 * `warmup` untimed frames; then applies the last patch and waits for it.
 */
export async function measurePositionPatch(
  page: Page,
  options: {
    contours: PerfContours;
    count: number | null;
    origin: Point2D;
    frames: number;
    warmup: number;
  },
): Promise<Samples> {
  return hooksOf(page).perf.measurePositionPatch(options);
}

/**
 * Pastes `contours`, selects all, and times moving every selected point one unit right per
 * frame through the layer, after `warmup` untimed frames.
 */
export async function measureNudge(
  page: Page,
  options: { contours: PerfContours; frames: number; warmup: number },
): Promise<Samples> {
  return hooksOf(page).perf.measureNudge(options);
}

/**
 * Pastes `contours`, moves every point in one applied patch, then times `sampleCount` rounds of
 * the edit coordinator's undo and redo.
 */
export async function measureUndoRedo(
  page: Page,
  options: { contours: PerfContours; sampleCount: number },
): Promise<{ undo: Samples; redo: Samples }> {
  return hooksOf(page).perf.measureUndoRedo(options);
}

/**
 * Pastes `contours`, selects all, and times `frames` rounds of a pan step and a zoom step
 * through the editor's camera commands.
 */
export async function measurePanZoom(
  page: Page,
  options: { contours: PerfContours; frames: number },
): Promise<{ pan: Samples; zoom: Samples }> {
  return hooksOf(page).perf.measurePanZoom(options);
}

/**
 * Moves the points matched to `ids` in each other source being edited by a different offset per
 * source, so the sources disagree before a multi-source benchmark; throws unless exactly
 * `expectedSources` other layers match every point.
 */
export async function offsetMatchedSourcePoints(
  page: Page,
  ids: readonly PointId[],
  expectedSources: number,
): Promise<void> {
  await hooksOf(page).perf.offsetMatchedSourcePoints(ids, expectedSources);
}
