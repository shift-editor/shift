import { Contour } from "@/lib/core/Contour";
import { Ident } from "@/lib/core/EntityId";
import { Path2D } from "@/lib/graphics/Path";
import { Point2D } from "@/types/math";

export interface ContourNode {
  contour: Contour;
  renderPath?: Path2D;
}

export class ContourManager {
  #currentContourId: Ident;
  #contours: Map<Ident, ContourNode> = new Map();

  constructor() {
    const c = new Contour();
    this.#contours.set(c.id, {
      contour: c,
      renderPath: new Path2D(),
    });
    this.#currentContourId = c.id;
  }

  get currentContour(): ContourNode {
    const c = this.#contours.get(this.#currentContourId);
    if (!c) {
      throw new Error("Current contour not found");
    }

    return c;
  }

  addPoint(point: Point2D): Ident {
    return this.currentContour.contour.addPoint(point);
  }

  addContour(): Ident {
    const c = new Contour();
    const node = { contour: c };
    this.#contours.set(c.id, node);

    return c.id;
  }

  get nodes(): ContourNode[] {
    return Array.from(this.#contours.values());
  }

  get currentPath(): Contour {
    return this.currentContour.contour;
  }
}
