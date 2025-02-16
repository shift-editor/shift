import { IPath, IRenderer } from "@/types/graphics";

import { ContourManager, ContourNode } from "./ContourManager";

const X_ADVANCE = 600;

const GUIDES = {
  ascender: { y: 750 },
  capHeight: { y: 700 },
  xHeight: { y: 500 },
  baseline: { y: 0 },
  descender: { y: -200 },
};

export class Scene {
  #contourManager: ContourManager;
  #staticGuides: IPath | null = null;

  public constructor() {
    this.#contourManager = new ContourManager();
  }

  setStaticGuides(ctx: IRenderer) {
    const path = ctx.createPath();

    Object.values(GUIDES).forEach(({ y }) => {
      path.moveTo(0, y);
      path.lineTo(X_ADVANCE, y);
    });

    path.moveTo(0, GUIDES.descender.y);
    path.lineTo(0, GUIDES.ascender.y);
    path.moveTo(X_ADVANCE, GUIDES.descender.y);
    path.lineTo(X_ADVANCE, GUIDES.ascender.y);

    this.#staticGuides = path;
  }

  getStaticGuidesPath(): IPath {
    if (!this.#staticGuides) {
      throw new Error("Static guides not set");
    }

    return this.#staticGuides;
  }

  public addPoint(x: number, y: number): void {
    this.#contourManager.addPoint(x, y);
  }

  public getNodes(): ContourNode[] {
    return this.#contourManager.nodes;
  }
}
