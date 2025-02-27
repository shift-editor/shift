import { Contour } from "@/lib/core/Contour";
import { EntityId, Ident } from "@/lib/core/EntityId";
import { Path2D } from "@/lib/graphics/Path";
import { Point2D } from "@/types/math";

export interface ContourNode {
  contour: Contour;
  renderPath: Path2D;
}

export class ContourManager {
  #currentContourId: EntityId;
  #contours: Map<Ident, ContourNode> = new Map();

  constructor() {
    const c = new Contour();
    this.#contours.set(c.entityId.id, {
      contour: c,
      renderPath: new Path2D(),
    });
    this.#currentContourId = c.entityId;
  }

  get currentContour(): ContourNode {
    const c = this.#contours.get(this.#currentContourId.id);
    if (!c) {
      throw new Error("Current contour not found");
    }

    return c;
  }

  addPoint(point: Point2D): EntityId {
    const id = this.currentContour.contour.addPoint(point);
    if (this.currentContour.contour.closed()) {
      this.#currentContourId = this.addContour();
    }

    return id;
  }

  movePointTo(point: Point2D, id: EntityId) {
    const c = this.#contours.get(id.parentId);
    if (!c) {
      console.error("No parentId for point");
      return;
    }

    const p = c.contour.points().find((p) => {
      return p.entityId.id == id.id;
    });

    if (!p) {
      console.error("point not found");
      return;
    }

    p.movePointTo(point.x, point.y);
  }

  addContour(): EntityId {
    const c = new Contour();
    const node = { contour: c, renderPath: new Path2D(), invalidated: false };
    this.#contours.set(c.entityId.id, node);

    return c.entityId;
  }

  invalidateContour(id: Ident): void {
    const node = this.#contours.get(id);
    if (!node) {
      return;
    }

    node.renderPath.invalidated = true;
  }

  upgradeLineSegment(id: Ident): void {
    this.currentContour.contour.upgradeLineSegment(id);
  }

  buildRenderPaths(): void {
    for (const node of this.#contours.values()) {
      if (node.contour.points().length < 2) {
        continue;
      }

      node.renderPath.clear();

      const segments = node.contour.segments();
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
            break;
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
