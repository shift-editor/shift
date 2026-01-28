import type { Point2D } from "@shift/types";
import type { ReflectAxis, SelectionBounds } from "@/lib/transform";

export interface TransformServiceDeps {
  rotateSelection: (angle: number, origin?: Point2D) => void;
  scaleSelection: (sx: number, sy: number, origin?: Point2D) => void;
  reflectSelection: (axis: ReflectAxis, origin?: Point2D) => void;
  getSelectionBounds: () => SelectionBounds | null;
  getSelectionCenter: () => Point2D | null;
}

export class TransformService {
  #deps: TransformServiceDeps;

  constructor(deps: TransformServiceDeps) {
    this.#deps = deps;
  }

  rotate(angle: number, origin?: Point2D): void {
    this.#deps.rotateSelection(angle, origin);
  }

  scale(sx: number, sy?: number, origin?: Point2D): void {
    this.#deps.scaleSelection(sx, sy ?? sx, origin);
  }

  reflect(axis: ReflectAxis, origin?: Point2D): void {
    this.#deps.reflectSelection(axis, origin);
  }

  rotate90CCW(): void {
    this.#deps.rotateSelection(Math.PI / 2);
  }

  rotate90CW(): void {
    this.#deps.rotateSelection(-Math.PI / 2);
  }

  rotate180(): void {
    this.#deps.rotateSelection(Math.PI);
  }

  flipHorizontal(): void {
    this.#deps.reflectSelection("horizontal");
  }

  flipVertical(): void {
    this.#deps.reflectSelection("vertical");
  }

  getSelectionBounds(): SelectionBounds | null {
    return this.#deps.getSelectionBounds();
  }

  getSelectionCenter(): Point2D | null {
    return this.#deps.getSelectionCenter();
  }
}
