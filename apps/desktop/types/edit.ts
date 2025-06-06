import { ContourPoint } from '@/lib/core/Contour';
import { EditEngineContext } from '@/lib/core/EditEngine';

import { Point2D } from './math';

export type Edit = {
  point: ContourPoint;
  from: Point2D;
  to: Point2D;
};

export interface AppliedEdit {
  point: ContourPoint;
  edits: Edit[];
  affectedPoints: ContourPoint[];
}

export interface EditRule {
  description: string;
  match(point: ContourPoint): boolean;
  apply(ctx: EditEngineContext, point: ContourPoint, dx: number, dy: number): AppliedEdit;
}

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
