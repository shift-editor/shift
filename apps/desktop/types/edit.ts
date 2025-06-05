import { ContourPoint } from '@/lib/core/Contour';

import { Point2D } from './math';

export type Edit = {
  point: ContourPoint;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};
export interface EditSession {
  getMousePosition(x: number, y: number): Point2D;

  getSelectedPoints(): ContourPoint[];
  getAllPoints(): ContourPoint[];
  setSelectedPoints(points: ContourPoint[]): void;
  clearSelectedPoints(): void;

  getHoveredPoint(): ContourPoint | null;
  setHoveredPoint(point: ContourPoint | null): void;
  clearHoveredPoint(): void;

  preview(dx: number, dy: number): void;
  commit(dx: number, dy: number): void;
  redraw(): void;
}
