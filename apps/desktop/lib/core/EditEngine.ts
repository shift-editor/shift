import { AppliedEdit, Edit } from '@/types/edit';

import { ContourPoint } from './Contour';
import { BuildPattern } from './PatternParser';
import { BuildRuleTable, RuleTable } from './RuleTable';

export interface EditContext {
  getSelectedPoints(): Set<ContourPoint>;
  movePointBy(point: ContourPoint, dx: number, dy: number): void;
}

export class EditEngine {
  #context: EditContext;
  #ruleTable: RuleTable;

  public constructor(context: EditContext) {
    this.#context = context;
    this.#ruleTable = BuildRuleTable();
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
      this.#context.movePointBy(point, dx, dy);
      edits.push({
        point: point,
        edits: [edit],
        affectedPoints: [],
      });
    }

    // apply rules for affected points
    for (const point of selectedPoints) {
      const pattern = BuildPattern(point, selectedPoints);
      const rule = this.#ruleTable.get(pattern);
      if (rule) {
        const edit = rule.action(this.#context, point, dx, dy);
        edits.push(edit);
      }
    }

    return edits;
  }
}
