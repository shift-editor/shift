import { AppliedEdit, Edit, EditRule } from '@/types/edit';

import { ContourPoint } from './Contour';

const MoveAction: EditRule = {
  description: 'Move a point by a given delta',
  match(): boolean {
    return true;
  },
  apply(ctx: EditEngineContext, point: ContourPoint, dx: number, dy: number): AppliedEdit {
    ctx.movePointTo(point, point.x + dx, point.y + dy);

    return {
      point,
      edits: [
        {
          point,
          from: { x: point.x, y: point.y },
          to: { x: point.x + dx, y: point.y + dy },
        },
      ],
      affectedPoints: [],
    };
  },
};

const MoveNeighbourHandles: EditRule = {
  description: 'Moves unselected neighboring handles of a smooth|corner point',
  match(point: ContourPoint): boolean {
    if (point.pointType !== 'onCurve') {
      return false;
    }

    if (point.prevPoint === null && point.nextPoint === null) {
      return false;
    }

    if (point.prevPoint && point.prevPoint.pointType === 'offCurve') {
      return true;
    }

    if (point.nextPoint && point.nextPoint.pointType === 'offCurve') {
      return true;
    }

    return false;
  },
  apply(ctx: EditEngineContext, point: ContourPoint, dx: number, dy: number): AppliedEdit {
    const edits: Edit[] = [];
    const affectedPoints: ContourPoint[] = [];

    if (point.prevPoint) {
      affectedPoints.push(point.prevPoint);
      ctx.movePointTo(point.prevPoint, point.prevPoint.x + dx, point.prevPoint.y + dy);
      edits.push({
        point: point.prevPoint,
        from: { x: point.prevPoint.x, y: point.prevPoint.y },
        to: { x: point.prevPoint.x + dx, y: point.prevPoint.y + dy },
      });
    }

    if (point.nextPoint) {
      affectedPoints.push(point.nextPoint);
      ctx.movePointTo(point.nextPoint, point.nextPoint.x + dx, point.nextPoint.y + dy);
      edits.push({
        point: point.nextPoint,
        from: { x: point.nextPoint.x, y: point.nextPoint.y },
        to: { x: point.nextPoint.x + dx, y: point.nextPoint.y + dy },
      });
    }
    return {
      point,
      edits: edits,
      affectedPoints: [],
    };
  },
};

export interface EditEngineContext {
  getSelectedPoints(): ContourPoint[];
  movePointTo(point: ContourPoint, x: number, y: number): void;
}

const rules: EditRule[] = [MoveNeighbourHandles];

export class EditEngine {
  #context: EditEngineContext;
  #rules: EditRule[];

  public constructor(context: EditEngineContext) {
    this.#context = context;
    this.#rules = rules;
  }

  public applyEdits(dx: number, dy: number): AppliedEdit[] {
    const selectedPoints = this.#context.getSelectedPoints();
    const edits: AppliedEdit[] = [];

    // selected points
    for (const point of selectedPoints) {
      const edit = MoveAction.apply(this.#context, point, dx, dy);
      edits.push(edit);
    }

    // affected points
    for (const point of selectedPoints) {
      for (const rule of this.#rules) {
        if (rule.match(point)) {
          const edit = rule.apply(this.#context, point, dx, dy);
          edits.push(edit);
        }
      }
    }

    return edits;
  }
}
