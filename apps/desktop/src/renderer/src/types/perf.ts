import type { ContourContent } from "@/lib/clipboard";

/** Timed undo and redo samples from one benchmark run. */
export interface UndoRedoSamples {
  readonly undo: readonly number[];
  readonly redo: readonly number[];
}

/** Timed pan and zoom samples from one benchmark run. */
export interface PanZoomSamples {
  readonly pan: readonly number[];
  readonly zoom: readonly number[];
}

/** Mutation and rendered-frame timings from one editor operation. */
export interface RenderSamples {
  readonly mutation: readonly number[];
  readonly frame: readonly number[];
}

/** Typed renderer operations exposed only to Playwright performance tests. */
export interface PerfHarness {
  /**
   * Inserts contours into the current glyph and waits for Rust persistence.
   *
   * @param contours - Portable contours used to construct the stress glyph.
   * @returns The resulting point count after persistence settles.
   */
  insertContours(contours: ContourContent[]): Promise<number>;

  /**
   * Measures synchronous draft updates without waiting for rendered frames.
   *
   * @param pointLimit - Maximum selected points, or null for the entire glyph.
   * @param frames - Number of sequential draft updates to sample.
   * @returns One mutation duration per draft update.
   */
  translate(pointLimit: number | null, frames: number): Promise<readonly number[]>;

  /**
   * Measures whole-glyph draft updates and the scene frames they schedule.
   *
   * @param frames - Number of sequential draft and render updates to sample.
   * @returns Separate synchronous mutation and rendered-frame durations.
   */
  translateRendered(frames: number): Promise<RenderSamples>;

  /**
   * Measures local point updates before queued Rust persistence settles.
   *
   * @param frames - Number of local updates to enqueue.
   * @returns One enqueue duration per local update.
   */
  nudgeEnqueue(frames: number): readonly number[];

  /**
   * Measures settled Rust-backed undo and redo operations.
   *
   * @param frames - Number of undo/redo pairs to sample.
   * @returns Settled durations for each undo and redo.
   */
  undoRedo(frames: number): Promise<UndoRedoSamples>;

  /**
   * Measures pen-tool pointer dispatch against the current large glyph.
   *
   * @param count - Number of points to place through the active pen tool.
   * @returns One pointer-dispatch duration per point.
   */
  placePoints(count: number): Promise<readonly number[]>;

  /**
   * Measures rendered frames after camera pan and zoom updates.
   *
   * @param frames - Number of pan and zoom updates to sample.
   * @returns Rendered-frame durations for pan and zoom updates.
   */
  panZoom(frames: number): Promise<PanZoomSamples>;
}

declare global {
  interface Window {
    shiftPerf?: PerfHarness;
  }
}
