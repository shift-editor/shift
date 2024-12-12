import { Point } from "../lib/geometry/point";

export interface IRenderer {
  DrawPoint(p: Point): void;
}
