import { IPath } from "@/types/graphics";

import { Contour, ContourPoint } from "../core/Contour";
import { Ident } from "../core/EntityId";

export interface ContourNode {
  contour: Contour;
  renderPath?: IPath;
}

export class ContourManager {
  #currentContourId: Ident;
  #contours: Map<Ident, ContourNode> = new Map();

  constructor() {
    const c = new Contour();
    this.#contours.set(c.id, {
      contour: c,
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

  addContour(): Ident {
    const c = new Contour();
    const node = { contour: c, renderPath: new Path2D() };
    this.#contours.set(c.id, node);

    return c.id;
  }

  addPoint(x: number, y: number) {
    const newPoint = new ContourPoint(x, y, "onCurve", this.#currentContourId);
    this.currentContour.contour.points.push(newPoint);

    if (
      this.currentContour.contour.points.length > 1 &&
      newPoint.distance(this.currentContour.contour.points[0]) < 8
    ) {
      this.currentContour.contour.close();
      this.#currentContourId = this.addContour();
    }
  }

  get nodes(): ContourNode[] {
    return Array.from(this.#contours.values());
  }

  get currentPath(): Contour {
    return this.currentContour.contour;
  }
}
