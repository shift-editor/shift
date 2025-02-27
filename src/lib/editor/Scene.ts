import { EntityId, Ident } from "@/lib/core/EntityId";
import { Point2D } from "@/types/math";

import { ContourManager, ContourNode } from "./ContourManager";
import { ContourPoint } from "../core/Contour";
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

  public addPoint(point: Point2D): EntityId {
    return this.#contourManager.addPoint(point);
  }

  public movePointTo(point: Point2D, id: EntityId) {
    this.#contourManager.movePointTo(point, id);
  }

  public upgradeLineSegment(id: Ident): void {
    this.#contourManager.upgradeLineSegment(id);
  }

  public invalidateContour(id: Ident): void {
    this.#contourManager.invalidateContour(id);
  }

  // TODO: perhaps make this into a single functions where
  // you can pass optional IDs and if not it returns all points
  public getAllPoints(): ReadonlyArray<ContourPoint> {
    return this.#contourManager
      .nodes()
      .map((c) => {
        return c.contour.points();
      })
      .flat();
  }

  public getAllContours() {
    return this.#contourManager
      .nodes()
      .map((c) => {
        return c.contour;
      })
      .flat();
  }

  nodes(): ContourNode[] {
    return this.#contourManager.nodes();
  }
}
