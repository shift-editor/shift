import { AppliedEdit, Edit } from '@/types/edit';

import { ContourPoint } from './Contour';
import { EditContext } from './EditEngine';
import { PatternParser } from './PatternParser';

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
        ctx.movePointBy(nextPoint, dx, dy);

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
        ctx.movePointBy(prevPoint, dx, dy);

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

        ctx.movePointBy(prevPoint, dx, dy);
        ctx.movePointBy(nextPoint, dx, dy);

        return {
          point: point,
          edits: [edit1, edit2],
          affectedPoints: [prevPoint, nextPoint],
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
