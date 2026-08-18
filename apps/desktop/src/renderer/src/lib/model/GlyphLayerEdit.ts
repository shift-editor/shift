import { batch } from "@/lib/signals";
import type { CubicCurve } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import { mintPointId, type ContourId, type PointId, type PointSeed } from "@shift/types";
import type { GlyphLayer, GlyphLayerPosition, GlyphLayerPositions } from "@/lib/model/Glyph";
import type { GlyphLayerState } from "@/lib/model/GlyphLayerState";

/**
 * One reversible edit applied directly to the reactive glyph layer.
 *
 * Local mutations are immediately visible to every geometry consumer. Finishing
 * restores the latest accepted base and replays the final operations through the
 * workspace intent path in one reactive batch; canceling restores that base.
 */
export class GlyphLayerEdit {
  readonly #glyphLayer: GlyphLayer;
  readonly #state: GlyphLayerState;

  readonly #smoothPoints = new Map<PointId, boolean>();
  readonly #positions = new Map<string, GlyphLayerPosition>();
  #addedContourId: ContourId | null = null;
  #addedPoints: PointSeed[] = [];
  #closed = false;

  constructor(glyphLayer: GlyphLayer, state: GlyphLayerState) {
    this.#glyphLayer = glyphLayer;
    this.#state = state;
    this.#state.beginEdit(() => this.#reapply());
  }

  addCubic(contourId: ContourId, curve: CubicCurve): readonly [PointId, PointId, PointId] {
    this.#assertOpen();
    if (this.#addedContourId) throw new Error("glyph layer edit already added cubic topology");

    const controlStartId = mintPointId();
    const controlEndId = mintPointId();
    const endpointId = mintPointId();
    const points = [
      { id: controlStartId, ...Point.offCurve(curve.c0) },
      { id: controlEndId, ...Point.offCurve(curve.c1) },
      { id: endpointId, ...Point.onCurve(curve.p1) },
    ];

    if (!this.#state.buffers.addPoints(points, contourId)) {
      throw new Error(`cannot add cubic to contour ${contourId}`);
    }

    this.#addedContourId = contourId;
    this.#addedPoints = points;
    return [controlStartId, controlEndId, endpointId];
  }

  setPointSmooth(pointId: PointId, smooth: boolean): void {
    this.#assertOpen();
    if (!this.#state.buffers.setPointSmooth(pointId, smooth)) {
      throw new Error(`cannot set smoothness: point ${pointId} is not in the layer`);
    }

    this.#smoothPoints.set(pointId, smooth);
  }

  setPositions(positions: GlyphLayerPositions): void {
    this.#assertOpen();
    if (positions.length === 0) return;

    if (this.#state.positionsFor(positions).length !== positions.length) {
      throw new Error("cannot set positions outside the active glyph layer edit");
    }

    for (const position of positions) {
      this.#positions.set(`${position.kind}:${position.id}`, position);
    }
    this.#state.patchPositions(positions);
  }

  finish(label: string): void {
    if (this.#closed) return;
    this.#closed = true;

    this.#glyphLayer.transaction(label, () => {
      this.#state.finishEdit(() => {
        if (this.#addedContourId) {
          this.#glyphLayer.addPointSeeds(this.#addedContourId, this.#addedPoints);
        }

        for (const [pointId, smooth] of this.#smoothPoints) {
          this.#glyphLayer.setPointSmooth(pointId, smooth);
        }

        const positions = [...this.#positions.values()];
        if (positions.length > 0) this.#glyphLayer.applyPositionPatch(positions);
      });
    });
  }

  cancel(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#state.cancelEdit();
  }

  #reapply(): void {
    batch(() => {
      if (
        this.#addedContourId &&
        !this.#state.buffers.addPoints(this.#addedPoints, this.#addedContourId)
      ) {
        throw new Error(`cannot reapply cubic in contour ${this.#addedContourId}`);
      }

      for (const [pointId, smooth] of this.#smoothPoints) {
        if (!this.#state.buffers.setPointSmooth(pointId, smooth)) {
          throw new Error(`cannot reapply smoothness for point ${pointId}`);
        }
      }

      this.#state.patchPositions([...this.#positions.values()]);
    });
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("glyph layer edit is closed");
  }
}
