import { AppliedEdit, Edit } from '@/types/edit';

import { ContourPoint } from './Contour';
import { MaintainTangency } from './EditActions';
import { EditContext } from './EditEngine';
import { PatternParser } from './PatternParser';
import { Vector2D } from '../math/vector';

export type Pattern = string;

export interface Rule {
  pattern: Pattern;
  description: string;
  action(ctx: EditContext, point: ContourPoint, dx: number, dy: number): AppliedEdit;
}

export type RuleTemplate = Map<Pattern, Rule>;
export const RULE_TEMPLATES: RuleTemplate = new Map([
  [
    '[X@][CS]H',
    {
      pattern: '[X@][CS]H',
      description: 'move the right neighbour handle of an anchor point',
      action: (ctx, point, dx, dy) => {
        if (!point.nextPoint) {
          console.warn('expected next point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        const nextPoint = point.nextPoint;
        const edit: Edit = {
          point: nextPoint,
          from: { x: nextPoint.x, y: nextPoint.y },
          to: { x: nextPoint.x + dx, y: nextPoint.y + dy },
        };
        ctx.movePointTo(nextPoint, nextPoint.x + dx, nextPoint.y + dy);

        return {
          point: point,
          edits: [edit],
          affectedPoints: [nextPoint],
        };
      },
    },
  ],
  [
    'H[CS][X@]',
    {
      pattern: 'H[CS][X@]',
      description: 'move the left neighbour handle of an anchor point',
      action: (ctx, point, dx, dy) => {
        if (!point.prevPoint) {
          console.warn('expected prev point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        const prevPoint = point.prevPoint;
        const edit: Edit = {
          point: prevPoint,
          from: { x: prevPoint.x, y: prevPoint.y },
          to: { x: prevPoint.x + dx, y: prevPoint.y + dy },
        };
        ctx.movePointTo(prevPoint, prevPoint.x + dx, prevPoint.y + dy);

        return {
          point: point,
          edits: [edit],
          affectedPoints: [prevPoint],
        };
      },
    },
  ],
  [
    'H[CS]H',
    {
      pattern: 'H[CS]H',
      description: 'move the neighbour handles of an anchor point',
      action: (ctx, point, dx, dy) => {
        if (!point.prevPoint || !point.nextPoint) {
          console.warn('expected prev and next point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        const prevPoint = point.prevPoint;
        const nextPoint = point.nextPoint;
        const edit1: Edit = {
          point: prevPoint,
          from: { x: prevPoint.x, y: prevPoint.y },
          to: { x: prevPoint.x + dx, y: prevPoint.y + dy },
        };

        const edit2: Edit = {
          point: nextPoint,
          from: { x: nextPoint.x, y: nextPoint.y },
          to: { x: nextPoint.x + dx, y: nextPoint.y + dy },
        };

        ctx.movePointTo(prevPoint, prevPoint.x + dx, prevPoint.y + dy);
        ctx.movePointTo(nextPoint, nextPoint.x + dx, nextPoint.y + dy);

        return {
          point: point,
          edits: [edit1, edit2],
          affectedPoints: [prevPoint, nextPoint],
        };
      },
    },
  ],
  [
    'HS[HC][@X][@X]',
    {
      pattern: 'HSH[@X][@X]',
      description:
        'move the handle and maintain tangency through the anchor point with the opposite handle',
      action: (ctx, point, dx, dy) => {
        if (!point.prevPoint) {
          console.warn('expected an anchor point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        if (!point.prevPoint.prevPoint) {
          console.warn('expected opposite point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        const edit = MaintainTangency(
          ctx,
          point.prevPoint,
          point,
          point.prevPoint.prevPoint,
          dx,
          dy
        );

        return edit;
      },
    },
  ],
  [
    '[@X]HS',
    {
      pattern: '[@X]HS',
      description: 'move the handle of a smooth point',
      action: (ctx, point, dx, dy) => {
        if (!point.nextPoint) {
          console.warn('expected an anchor point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        if (!point.nextPoint.nextPoint) {
          console.warn('expected opposite point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        const edit = MaintainTangency(
          ctx,
          point.nextPoint,
          point,
          point.nextPoint.nextPoint,
          dx,
          dy
        );

        return edit;
      },
    },
  ],
  [
    'CSHHC',
    {
      pattern: 'CSHHC',
      description: 'move the handle of a smooth point',
      action(ctx, point, dx, dy) {
        if (!point.prevPoint) {
          console.warn('expected prev and next point');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        const anchor = point.prevPoint;
        if (!anchor.prevPoint) {
          console.warn('expected prev point of anchor');
          return {
            point: point,
            edits: [],
            affectedPoints: [],
          };
        }

        const cornerPoint = anchor.prevPoint;
        const toAnchor = new Vector2D(anchor.x - cornerPoint.x, anchor.y - cornerPoint.y);

        const newVector = new Vector2D(point.x + dx - anchor.x, point.y + dy - anchor.y);
        const finalVector = newVector.projectAbsolute(toAnchor);

        ctx.movePointTo(point, finalVector.x + anchor.x, finalVector.y + anchor.y);

        return {
          point: point,
          edits: [
            {
              point: point,
              from: { x: point.x, y: point.y },
              to: { x: finalVector.x + anchor.x, y: finalVector.y + anchor.y },
            },
          ],
          affectedPoints: [point, anchor, cornerPoint],
        };
      },
    },
  ],
]);

export type RuleTable = Map<Pattern, Rule>;
const buildRuleTable = (ruleTemplates: RuleTemplate): RuleTable => {
  const ruleTable: RuleTable = new Map();
  const parser = new PatternParser();

  for (const [pattern, rule] of ruleTemplates) {
    const patterns = parser.expand(pattern);

    for (const pattern of patterns) {
      ruleTable.set(pattern, rule);
    }
  }

  return ruleTable;
};

export const BuildRuleTable = (): RuleTable => {
  const ruleTable = buildRuleTable(RULE_TEMPLATES);
  return ruleTable;
};
