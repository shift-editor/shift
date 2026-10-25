import { batch } from "../signals";
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
 * One reversible edit to a glyph layer, previewed as it is made.
 *
 * Structural steps (contours, points, anchors, smoothness, closing) are shown
 * as the window's engine applies them to the base, without keeping them;
 * moved positions are patched on top. Finishing restores the base and commits
 * the final steps through the workspace intent path in one reactive batch;
 * canceling restores that base.
 */
export class GlyphLayerEdit {
  readonly #glyphLayer: GlyphLayer;
  readonly #state: GlyphLayerState;

  readonly #contours = new Map<ContourId, boolean>();
  readonly #points = new Map<ContourId, PointSeed[]>();
  readonly #anchors = new Map<AnchorId, AnchorSeed>();
  readonly #smoothPoints = new Map<PointId, boolean>();
  readonly #positions = new Map<string, GlyphLayerPosition>();
  readonly #closedContours = new Set<ContourId>();
  #closed = false;

  constructor(glyphLayer: GlyphLayer, state: GlyphLayerState) {
    this.#glyphLayer = glyphLayer;
    this.#state = state;
    this.#state.beginEdit(() => this.#preview());
  }

  addContour(closed: boolean): ContourId {
    this.#assertOpen();

    const contourId = mintContourId();
    this.#contours.set(contourId, closed);
    this.#preview();
    return contourId;
  }

  addPoints(contourId: ContourId, points: readonly NewPoint[]): readonly PointId[] {
    this.#assertOpen();
    if (points.length === 0) return [];

    const seeds = points.map((point) => ({ id: mintPointId(), ...point }));
    const previous = this.#points.get(contourId) ?? [];
    this.#points.set(contourId, [...previous, ...seeds]);
    this.#preview();
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
    this.#anchors.set(anchor.id, anchor);
    this.#preview();
    return anchor.id;
  }

  setPointSmooth(pointId: PointId, smooth: boolean): void {
    this.#assertOpen();
    this.#smoothPoints.set(pointId, smooth);
    this.#preview();
  }

  closeContour(contourId: ContourId): void {
    this.#assertOpen();
    this.#closedContours.add(contourId);
    this.#preview();
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
        this.#structuralSteps();
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

  /**
   * Shows the gesture so far: its structural steps as the window's engine
   * applies them to the base, then the positions it has moved on top.
   */
  #preview(): void {
    batch(() => {
      this.#glyphLayer.preview(() => this.#structuralSteps());
      this.#state.patchPositions([...this.#positions.values()]);
    });
  }

  /** The gesture's contours, points, anchors, smoothness and closings, as the commit sends them. */
  #structuralSteps(): void {
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
    for (const contourId of this.#closedContours) {
      this.#glyphLayer.closeContour(contourId);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("glyph layer edit is closed");
  }
}
