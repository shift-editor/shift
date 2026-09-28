import { Point } from "@shift/glyph-state";
import { mintPointId, type ContourId, type PointSeed } from "@shift/types";
import type { GlyphLayer } from "./Glyph";

/** One open end of a contour. */
export interface ContourEnd {
  readonly contourId: ContourId;
  readonly side: "start" | "end";
}

/**
 * Connects two open contour ends in one layer transaction.
 *
 * Two ends of the same contour close it; ends of different contours join them into
 * one open contour that keeps the `from` contour's identity. With `merge`, the `from`
 * end point is dropped so the `to` end point takes its place, which is how an end
 * dropped onto another end behaves. Without it, a line segment connects the two ends.
 */
export class JoinContours {
  readonly #layer: GlyphLayer;
  readonly #from: ContourEnd;
  readonly #to: ContourEnd;
  readonly #merge: boolean;

  constructor(layer: GlyphLayer, from: ContourEnd, to: ContourEnd, merge: boolean) {
    this.#layer = layer;
    this.#from = from;
    this.#to = to;
    this.#merge = merge;
  }

  /**
   * @returns Whether both ends were open ends of distinct points and were connected.
   */
  apply(): boolean {
    const from = this.#layer.contour(this.#from.contourId);
    const to = this.#layer.contour(this.#to.contourId);
    if (!from || !to || from.closed || to.closed) return false;

    if (from.id === to.id) return this.#close();
    return this.#join();
  }

  #close(): boolean {
    if (this.#from.side === this.#to.side) return false;

    const contour = this.#layer.contour(this.#from.contourId);
    const dropped = this.#from.side === "start" ? contour?.firstPoint : contour?.lastPoint;
    if (!contour || !dropped || contour.points.filter(Point.isOnCurve).length < 2) return false;

    return this.#layer.transaction("Close contour", () => {
      if (this.#merge) this.#layer.removePoints([dropped.id]);
      this.#layer.closeContour(contour.id);
      return true;
    });
  }

  #join(): boolean {
    const fromId = this.#from.contourId;
    const toId = this.#to.contourId;

    return this.#layer.transaction("Join contours", () => {
      if (this.#from.side === "start") this.#layer.reverseContour(fromId);
      if (this.#to.side === "end") this.#layer.reverseContour(toId);

      const from = this.#layer.contour(fromId);
      const to = this.#layer.contour(toId);
      const dropped = from?.lastPoint;
      if (!from || !to || !dropped) return false;

      if (this.#merge && from.points.length === 1) {
        this.#layer.removePoints([dropped.id]);
        return true;
      }

      const seeds: PointSeed[] = to.points.map((point) => ({
        id: mintPointId(),
        x: point.x,
        y: point.y,
        pointType: point.pointType,
        smooth: point.smooth,
      }));

      this.#layer.removePoints(to.points.map((point) => point.id));
      if (this.#merge) this.#layer.removePoints([dropped.id]);
      this.#layer.addPointSeeds(fromId, seeds);
      return true;
    });
  }
}
