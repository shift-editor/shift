import { Contour, ContourPoint } from "@/lib/core/Contour";
import { Ident } from "@/lib/core/EntityId";
import { IPath, IRenderer } from "@/types/graphics";
import { Segment } from "@/types/segments";

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
    const node = { contour: c };
    this.#contours.set(c.id, node);

    return c.id;
  }

  addSegment(segment: Segment) {}

  get nodes(): ContourNode[] {
    return Array.from(this.#contours.values());
  }

  get currentPath(): Contour {
    return this.currentContour.contour;
  }

  rebuildRenderPaths(ctx: IRenderer): IPath[] {
    const paths: IPath[] = [];
    for (const node of this.nodes) {
      const path = ctx.createPath();
    }

    return paths;
  }
}
