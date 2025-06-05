import { Edit } from '@/types/edit';

import { ContourPoint } from './Contour';

export interface EditEngineContext {
  getSelectedPoints(): ContourPoint[];
  movePointBy(point: ContourPoint, dx: number, dy: number): void;
}

export class EditEngine {
  #context: EditEngineContext;

  public constructor(context: EditEngineContext) {
    this.#context = context;
  }

  public previewEdits(dx: number, dy: number): void {
    for (const point of this.#context.getSelectedPoints()) {
      this.#context.movePointBy(point, dx, dy);
    }
  }

  public commitEdits(dx: number, dy: number): Edit[] {
    const edits: Edit[] = [];
    for (const point of this.#context.getSelectedPoints()) {
      edits.push({
        point,
        fromX: point.x - dx,
        fromY: point.y - dy,
        toX: point.x,
        toY: point.y,
      });
    }

    return edits;
  }
}
