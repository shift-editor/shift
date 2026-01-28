import type { Point2D } from "@shift/types";
import type { ViewportManager } from "../managers";

export class ViewportService {
  #viewport: ViewportManager;

  constructor(viewport: ViewportManager) {
    this.#viewport = viewport;
  }

  getZoom(): number {
    return this.#viewport.zoom.value;
  }

  pan(dx: number, dy: number): void {
    this.#viewport.pan(dx, dy);
  }

  getPan(): Point2D {
    return { x: this.#viewport.panX, y: this.#viewport.panY };
  }

  zoomIn(): void {
    this.#viewport.zoomIn();
  }

  zoomOut(): void {
    this.#viewport.zoomOut();
  }

  zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void {
    this.#viewport.zoomToPoint(screenX, screenY, zoomDelta);
  }
}
