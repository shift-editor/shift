import { AppliedEdit, Edit } from '@/types/edit';

import { ContourPoint } from './Contour';
import { PatternMatcher } from './PatternMatcher';

export interface EditContext {
  getSelectedPoints(): Set<ContourPoint>;
  movePointTo(point: ContourPoint, x: number, y: number): void;
}

export class EditEngine {
  #context: EditContext;
  #patternMatcher: PatternMatcher;

  public constructor(context: EditContext) {
    this.#context = context;
    this.#patternMatcher = new PatternMatcher();
  }

  public applyEdits(dx: number, dy: number): AppliedEdit[] {
    const selectedPoints = this.#context.getSelectedPoints();
    const edits: AppliedEdit[] = [];

    // move selected points
    for (const point of selectedPoints) {
      const edit: Edit = {
        point: point,
        from: { x: point.x, y: point.y },
        to: { x: point.x + dx, y: point.y + dy },
      };

      this.#context.movePointTo(point, point.x + dx, point.y + dy);
      edits.push({
        point: point,
        edits: [edit],
        affectedPoints: [],
      });
    }

    // apply rules for affected points
    for (const point of selectedPoints) {
      const rule = this.#patternMatcher.match(point, selectedPoints);
      if (rule) {
        const edit = rule.action(this.#context, point, dx, dy);
        edits.push(edit);
      }
    }

    return edits;
  }
}
