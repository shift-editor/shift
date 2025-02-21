import { Point2D } from "@/types/math";

import { ContourManager, ContourNode } from "./ContourManager";
import { Path2D } from "../graphics/Path";

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
  #staticGuides: Path2D;

  public constructor() {
    this.#contourManager = new ContourManager();
    this.#staticGuides = new Path2D();

    Object.values(GUIDES).forEach(({ y }) => {
      this.#staticGuides.moveTo(0, y);
      this.#staticGuides.lineTo(X_ADVANCE, y);
    });

    this.#staticGuides.moveTo(0, GUIDES.descender.y);
    this.#staticGuides.lineTo(0, GUIDES.ascender.y);
    this.#staticGuides.moveTo(X_ADVANCE, GUIDES.descender.y);
    this.#staticGuides.lineTo(X_ADVANCE, GUIDES.ascender.y);
  }

  public getStaticGuidesPath(): Path2D {
    return this.#staticGuides;
  }

  public addPoint(point: Point2D): void {
    this.#contourManager.addPoint(point);
  }

  public getNodes(): ContourNode[] {
    return this.#contourManager.nodes();
  }
}
