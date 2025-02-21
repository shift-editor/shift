import { Contour } from "@/lib/core/Contour";
import { Ident } from "@/lib/core/EntityId";
import { Path2D } from "@/lib/graphics/Path";
import { Point2D } from "@/types/math";

export interface ContourNode {
  contour: Contour;
  renderPath: Path2D;
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
    const id = this.currentContour.contour.addPoint(point);
    if (this.currentContour.contour.closed()) {
      this.#currentContourId = this.addContour();
      return this.#currentContourId;
    }

    return id;
  }

  addContour(): Ident {
    const c = new Contour();
    const node = { contour: c, renderPath: new Path2D() };
    this.#contours.set(c.id, node);

    return c.id;
  }

  buildRenderPaths(): void {
    for (const node of this.#contours.values()) {
      if (node.contour.points().length < 2) {
        continue;
      }

      const segments = node.contour.segments();

      node.renderPath = new Path2D();
      node.renderPath.moveTo(segments[0].anchor1.x, segments[0].anchor1.y);

      for (const segment of segments) {
        switch (segment.type) {
          case "line":
            node.renderPath.lineTo(segment.anchor2.x, segment.anchor2.y);
            break;
          case "cubic":
            node.renderPath.cubicTo(
              segment.control1.x,
              segment.control1.y,
              segment.control2.x,
              segment.control2.y,
              segment.anchor2.x,
              segment.anchor2.y,
            );
        }
      }
    }
  }

  nodes(): ContourNode[] {
    this.buildRenderPaths();
    return Array.from(this.#contours.values());
  }

  get currentPath(): Contour {
    return this.currentContour.contour;
  }
}
