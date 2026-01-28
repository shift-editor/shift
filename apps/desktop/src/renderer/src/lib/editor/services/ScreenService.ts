import type { Point2D } from "@shift/types";
import type { ViewportManager } from "../managers";
import { SCREEN_HIT_RADIUS } from "../rendering/constants";

export class ScreenService {
  #viewport: ViewportManager;

  constructor(viewport: ViewportManager) {
    this.#viewport = viewport;
  }

  toUpmDistance(pixels: number): number {
    return this.#viewport.screenToUpmDistance(pixels);
  }

  get hitRadius(): number {
    return this.#viewport.screenToUpmDistance(SCREEN_HIT_RADIUS);
  }

  lineWidth(pixels = 1): number {
    return this.#viewport.screenToUpmDistance(pixels);
  }

  projectScreenToUpm(x: number, y: number): Point2D {
    return this.#viewport.projectScreenToUpm(x, y);
  }

  getMousePosition(x?: number, y?: number): Point2D {
    return this.#viewport.getMousePosition(x, y);
  }
}
