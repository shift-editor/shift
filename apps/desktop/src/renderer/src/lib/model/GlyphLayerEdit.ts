import { batch } from "@/lib/signals";
import type { Point2D } from "@shift/geo";
import type { NewPoint } from "@shift/glyph-state";
import {
  mintAnchorId,
  mintContourId,
  mintPointId,
  type AnchorId,
  type AnchorSeed,
  type ContourId,
  type PointId,
  type PointSeed,
} from "@shift/types";
import type { GlyphLayer, GlyphLayerPosition, GlyphLayerPositions } from "./Glyph";
import type { GlyphLayerState } from "./GlyphLayerState";

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

  readonly #contours = new Map<ContourId, boolean>();
  readonly #points = new Map<ContourId, PointSeed[]>();
  readonly #anchors = new Map<AnchorId, AnchorSeed>();
  readonly #smoothPoints = new Map<PointId, boolean>();
  readonly #positions = new Map<string, GlyphLayerPosition>();
  #closed = false;

  constructor(glyphLayer: GlyphLayer, state: GlyphLayerState) {
    this.#glyphLayer = glyphLayer;
    this.#state = state;
    this.#state.beginEdit(() => this.#reapply());
  }

  addContour(closed: boolean): ContourId {
    this.#assertOpen();

    const contourId = mintContourId();
    if (!this.#state.buffers.addContour(contourId, closed)) {
      throw new Error("cannot add contour to the active glyph layer edit");
    }

    this.#contours.set(contourId, closed);
    return contourId;
  }

  addPoints(contourId: ContourId, points: readonly NewPoint[]): readonly PointId[] {
    this.#assertOpen();
    if (points.length === 0) return [];

    const seeds = points.map((point) => ({ id: mintPointId(), ...point }));
    if (!this.#state.buffers.addPoints(seeds, contourId)) {
      throw new Error(`cannot add points to contour ${contourId}`);
    }

    const previous = this.#points.get(contourId) ?? [];
    this.#points.set(contourId, [...previous, ...seeds]);
    return seeds.map((point) => point.id);
  }

  addAnchor(name: string | null, position: Point2D): AnchorId {
    this.#assertOpen();

    const anchor: AnchorSeed = {
      id: mintAnchorId(),
      x: position.x,
      y: position.y,
      ...(name === null ? {} : { name }),
    };
    if (!this.#state.buffers.addAnchors([anchor])) {
      throw new Error("cannot add anchor to the active glyph layer edit");
    }

    this.#anchors.set(anchor.id, anchor);
    return anchor.id;
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
        for (const [contourId, closed] of this.#contours) {
          this.#glyphLayer.addContourSeed(contourId, closed);
        }

        for (const [contourId, points] of this.#points) {
          this.#glyphLayer.addPointSeeds(contourId, points);
        }

        this.#glyphLayer.addAnchorSeeds([...this.#anchors.values()]);

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
      for (const [contourId, closed] of this.#contours) {
        if (!this.#state.buffers.addContour(contourId, closed)) {
          throw new Error(`cannot reapply contour ${contourId}`);
        }
      }

      for (const [contourId, points] of this.#points) {
        if (!this.#state.buffers.addPoints(points, contourId)) {
          throw new Error(`cannot reapply points in contour ${contourId}`);
        }
      }

      const anchors = [...this.#anchors.values()];
      if (anchors.length > 0 && !this.#state.buffers.addAnchors(anchors)) {
        throw new Error("cannot reapply anchors");
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
