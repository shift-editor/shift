/**
 * Times the main-thread frames that handle each real pointer move, for perf specs.
 *
 * - **work**: main-thread time in the animation frames that handle the move
 *   (hit testing, preview, and every render pass), without waiting for vsync.
 * - **frame**: main-thread time of the move's heaviest frame, from its first
 *   animation-frame callback until the browser has painted it and committed
 *   it to the compositor. A frame over the display's interval drops a frame.
 */
import type { Page } from "@playwright/test";
import type { Point2D } from "@shift/geo";

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
