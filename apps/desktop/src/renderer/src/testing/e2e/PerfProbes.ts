import type { Editor } from "@shift/editor";
import type { ContourContent } from "@shift/editor/clipboard";
import type { ScreenPoint } from "@shift/editor/spaces";
import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";

/** The contours a benchmark pastes, as `insertContent` takes them. */
export type BenchmarkContours = readonly ContourContent[];

/** One timing per sample, in milliseconds. */
export type Samples = number[];

/**
 * In-page benchmarks for the perf specs: each times one editor operation per sample with
 * `performance.now()` in the renderer, so no round trip is part of a sample.
 *
 * @remarks
 * Served through the E2E hook for test launches only.
 */
export class PerfProbes {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Pastes `contours` in one `insertContent` call and times it. */
  timeContourInsertion(contours: BenchmarkContours): {
    count: number;
    lastId: string | undefined;
    ms: number;
  } {
    const start = performance.now();
    const inserted = this.#editor.insertContent({ contours: [...contours] });
    if (!inserted) throw new Error("contour insertion failed");
    return { count: inserted.length, lastId: inserted.at(-1), ms: performance.now() - start };
  }

  /**
   * Pastes `contours`, selects all, and times the layer's preview position patch for the first
   * `count` selected points (all when null), moving them one unit per frame from `origin`, after
   * `warmup` untimed frames; then applies the last patch and waits for it.
   */
  async measurePositionPatch(options: {
    contours: BenchmarkContours;
    count: number | null;
    origin: Point2D;
    frames: number;
    warmup: number;
  }): Promise<Samples> {
    const { count, origin, frames, warmup } = options;
    const layer = await this.#pasteAndSelect(options.contours);
    const selected = this.#editor.selection.ids as readonly PointId[];
    const pointIds = count === null ? selected : selected.slice(0, count);
    const patch = (index: number) =>
      pointIds.map((id, pointIndex) => ({
        kind: "point" as const,
        id,
        x: origin.x + index + pointIndex,
        y: origin.y + index + pointIndex,
      }));

    let updates = patch(0);
    const times: Samples = [];
    for (let index = -warmup; index < frames; index++) {
      const start = performance.now();
      updates = patch(index);
      layer.previewPositionPatch(updates);
      if (index >= 0) times.push(performance.now() - start);
    }

    layer.applyPositionPatch(updates);
    await this.#editor.font.editCoordinator.settled();
    return times;
  }

  /**
   * Pastes `contours`, selects all, and times moving every selected point one unit right per
   * frame through the layer, after `warmup` untimed frames.
   */
  async measureNudge(options: {
    contours: BenchmarkContours;
    frames: number;
    warmup: number;
  }): Promise<Samples> {
    const layer = await this.#pasteAndSelect(options.contours);
    const pointIds = this.#editor.selection.ids as readonly PointId[];
    const times: Samples = [];
    for (let index = -options.warmup; index < options.frames; index++) {
      const start = performance.now();
      layer.movePoints(pointIds, { x: 1, y: 0 });
      if (index >= 0) times.push(performance.now() - start);
    }
    return times;
  }

  /**
   * Pastes `contours`, moves every point in one applied patch, then times `sampleCount` rounds of
   * the edit coordinator's undo and redo.
   */
  async measureUndoRedo(options: {
    contours: BenchmarkContours;
    sampleCount: number;
  }): Promise<{ undo: Samples; redo: Samples }> {
    const coordinator = this.#editor.font.editCoordinator;
    const layer = await this.#pasteAndSelect(options.contours);
    const pointIds = this.#editor.selection.ids as readonly PointId[];
    const updates = pointIds.map((id, index) => ({
      kind: "point" as const,
      id,
      x: index + 10,
      y: index + 10,
    }));
    layer.previewPositionPatch(updates);
    layer.applyPositionPatch(updates);
    await coordinator.settled();

    const undo: Samples = [];
    const redo: Samples = [];
    for (let index = 0; index < options.sampleCount; index++) {
      const undoStart = performance.now();
      await coordinator.undo();
      undo.push(performance.now() - undoStart);

      const redoStart = performance.now();
      await coordinator.redo();
      redo.push(performance.now() - redoStart);
    }
    return { undo, redo };
  }

  /**
   * Pastes `contours`, selects all, and times `frames` rounds of a pan step and a zoom step
   * through the editor's camera commands.
   */
  async measurePanZoom(options: {
    contours: BenchmarkContours;
    frames: number;
  }): Promise<{ pan: Samples; zoom: Samples }> {
    const editor = this.#editor;
    await this.#pasteAndSelect(options.contours);
    const pan: Samples = [];
    const zoom: Samples = [];
    for (let index = 0; index < options.frames; index++) {
      const panStart = performance.now();
      editor.setPan({ x: index * 10, y: index * 5 });
      pan.push(performance.now() - panStart);

      const zoomStart = performance.now();
      editor.zoomToPoint({ x: 640, y: 400 } as ScreenPoint, 0.01);
      zoom.push(performance.now() - zoomStart);
    }
    return { pan, zoom };
  }

  /** Pastes `contours`, waits for it, selects all, and returns the selection's editable layer. */
  async #pasteAndSelect(contours: BenchmarkContours) {
    const editor = this.#editor;
    const inserted = editor.insertContent({ contours: [...contours] });
    if (!inserted) throw new Error("contour insertion failed");

    await editor.font.editCoordinator.settled();
    editor.selectAll();
    const layer = editor.layerForGeometry({ points: editor.selection.ids as readonly PointId[] });
    if (!layer) throw new Error("selected points have no editable layer");
    return layer;
  }
  /**
   * Moves the points matched to `ids` in each other source being edited by a different offset
   * per source, so the sources disagree, and waits for the edit.
   *
   * @remarks
   * No public command moves matched points in other sources apart from the active one, so this
   * moves each matched layer's points directly. It is setup for multi-source drag benchmarks.
   * @throws {Error} unless exactly `expectedSources` other layers match every point.
   */
  async offsetMatchedSourcePoints(ids: readonly PointId[], expectedSources: number): Promise<void> {
    const targets = this.#editor.positionSelection(ids)?.additionalLayers;
    if (targets?.length !== expectedSources) {
      throw new Error(`Expected ${expectedSources} matched source layers`);
    }
    for (const [index, target] of targets.entries()) {
      const points = target.targets.points;
      if (points?.length !== ids.length) throw new Error("Expected a complete point match");
      target.layer.movePoints(points, { x: 40 * (index + 1), y: 25 * (index + 1) });
    }
  }
}
