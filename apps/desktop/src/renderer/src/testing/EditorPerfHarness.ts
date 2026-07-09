import type { PointId } from "@shift/types";
import type { ContourContent } from "@/lib/clipboard";
import type { Editor } from "@/lib/editor/Editor";
import { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { PanZoomSamples, PerfHarness, RenderSamples, UndoRedoSamples } from "@/types/perf";

const NO_MODIFIERS = {
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
};

/** Runs typed large-glyph benchmarks against one live editor. */
export class EditorPerfHarness implements PerfHarness {
  readonly #editor: Editor;

  /**
   * Binds the Playwright benchmark surface to an editor session.
   *
   * @param editor - Live editor whose real model, renderer, and bridge are measured.
   */
  constructor(editor: Editor) {
    this.#editor = editor;
  }

  async insertContours(contours: ContourContent[]): Promise<number> {
    const expectedPointCount = contours.reduce(
      (count, contour) => count + contour.points.length,
      0,
    );
    const inserted = this.#editor.insertContent({ contours }, { offset: { x: 0, y: 0 } });
    if (!inserted) throw new Error("perf content could not be inserted");

    await this.#editor.font.editCoordinator.settled();

    const pointCount = this.#layer().pointCount;
    if (pointCount < expectedPointCount) {
      throw new Error(`perf setup inserted ${pointCount} of ${expectedPointCount} points`);
    }

    return pointCount;
  }

  async translate(pointLimit: number | null, frames: number): Promise<readonly number[]> {
    const layer = this.#layer();
    const pointIds = this.#pointIds(layer, pointLimit);
    const draft = new GlyphLayerEditDraft(layer, { points: pointIds });
    const base = draft.basePositions;
    const samples: number[] = [];

    this.#editor.selection.select(pointIds);

    for (let frame = 0; frame < frames; frame++) {
      const start = performance.now();
      draft.previewPositionPatch(
        base.map((position) => ({
          ...position,
          x: position.x + frame + 1,
          y: position.y + frame + 1,
        })),
      );
      samples.push(performance.now() - start);
    }

    draft.commit();
    await this.#editor.font.editCoordinator.settled();

    return samples;
  }

  async translateRendered(frames: number): Promise<RenderSamples> {
    this.#assertGpuMarkers();

    const layer = this.#layer();
    const pointIds = this.#pointIds(layer, null);
    const draft = new GlyphLayerEditDraft(layer, { points: pointIds });
    const base = draft.basePositions;
    const mutation: number[] = [];
    const frameSamples: number[] = [];

    this.#editor.selection.select(pointIds);

    for (let frame = 0; frame < frames; frame++) {
      const frameStart = performance.now();
      const mutationStart = performance.now();

      draft.previewPositionPatch(
        base.map((position) => ({
          ...position,
          x: position.x + frame + 1,
          y: position.y + frame + 1,
        })),
      );
      mutation.push(performance.now() - mutationStart);

      await nextAnimationFrame();
      frameSamples.push(performance.now() - frameStart);
    }

    draft.commit();
    await this.#editor.font.editCoordinator.settled();

    return { mutation, frame: frameSamples };
  }

  nudgeEnqueue(frames: number): readonly number[] {
    const layer = this.#layer();
    const pointIds = this.#pointIds(layer, null);
    const samples: number[] = [];

    this.#editor.selection.select(pointIds);

    for (let frame = 0; frame < frames; frame++) {
      const start = performance.now();
      layer.movePoints(pointIds, { x: 1, y: 0 });
      samples.push(performance.now() - start);
    }

    return samples;
  }

  async undoRedo(frames: number): Promise<UndoRedoSamples> {
    const layer = this.#layer();
    const pointIds = this.#pointIds(layer, null);
    const draft = new GlyphLayerEditDraft(layer, { points: pointIds });

    draft.previewTranslate({ x: 10, y: 10 });
    draft.commit();
    await this.#editor.font.editCoordinator.settled();

    const undo: number[] = [];
    const redo: number[] = [];

    for (let frame = 0; frame < frames; frame++) {
      const undoStart = performance.now();
      await this.#editor.font.editCoordinator.undo();
      undo.push(performance.now() - undoStart);

      const redoStart = performance.now();
      await this.#editor.font.editCoordinator.redo();
      redo.push(performance.now() - redoStart);
    }

    return { undo, redo };
  }

  async placePoints(count: number): Promise<readonly number[]> {
    const samples: number[] = [];

    this.#editor.setActiveTool("pen");

    for (let index = 0; index < count; index++) {
      const point = {
        x: 100 + (index % 50) * 10,
        y: 100 + Math.floor(index / 50) * 10,
      };
      const start = performance.now();

      this.#editor.toolManager.handlePointerDown(point, NO_MODIFIERS);
      this.#editor.toolManager.handlePointerUp(point, NO_MODIFIERS);
      samples.push(performance.now() - start);
    }

    await this.#editor.font.editCoordinator.settled();

    return samples;
  }

  async panZoom(frames: number): Promise<PanZoomSamples> {
    this.#assertGpuMarkers();

    const pointIds = this.#pointIds(this.#layer(), null);
    const pan: number[] = [];
    const zoom: number[] = [];

    this.#editor.selection.select(pointIds);

    for (let frame = 0; frame < frames; frame++) {
      const panStart = performance.now();
      this.#editor.setPan({ x: frame * 10, y: frame * 5 });
      await nextAnimationFrame();
      pan.push(performance.now() - panStart);

      const zoomStart = performance.now();
      this.#editor.zoomToPoint(640, 400, 0.01);
      await nextAnimationFrame();
      zoom.push(performance.now() - zoomStart);
    }

    return { pan, zoom };
  }

  #layer(): GlyphLayer {
    const sourceId = this.#editor.activeSourceId;
    if (!sourceId) throw new Error("perf benchmark requires an active source");

    const nodes = this.#editor.scene.nodesOfKind("glyph");
    if (nodes.length !== 1) throw new Error("perf benchmark requires one glyph node");

    const node = nodes[0]!;
    const layer = this.#editor.font.layer(node.glyphId, sourceId);
    if (!layer) throw new Error("perf benchmark requires an authored glyph layer");

    return layer;
  }

  #pointIds(layer: GlyphLayer, limit: number | null): PointId[] {
    const points = limit === null ? layer.allPoints : layer.allPoints.slice(0, limit);
    return points.map((point) => point.id);
  }

  #assertGpuMarkers(): void {
    const canvas = document.querySelector<HTMLCanvasElement>("#marker-canvas");
    if (!canvas) throw new Error("perf benchmark requires the marker canvas");
    if (!canvas.getContext("webgl")) {
      throw new Error("perf benchmark requires an active WebGL marker context");
    }
  }
}

async function nextAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
