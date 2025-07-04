import { ContourPoint } from './Contour';
import { TOKENS } from './PatternParser';
import { BuildRuleTable, Pattern, Rule, RuleTable } from './RuleTable';

const WINDOW_SIZES = [3, 5];

export class PatternMatcher {
  #ruleTable: RuleTable;

  public constructor() {
    this.#ruleTable = BuildRuleTable();
  }

  #pointPattern(
    point: ContourPoint | null,
    selectedPoints: Set<ContourPoint>,
    centralPoint: boolean
  ): Pattern {
    if (!point) {
      return TOKENS.NO_POINT;
    }

    if (selectedPoints.has(point) && !centralPoint) {
      return TOKENS.SELECTED_POINT;
    }

    switch (point.pointType) {
      case 'onCurve':
        return point.smooth ? TOKENS.SMOOTH : TOKENS.CORNER;
      case 'offCurve':
        return TOKENS.HANDLE;
    }
  }

  /**
   * Gets a point at a specific distance from the central point
   * @param centralPoint The central point to expand from
   * @param distance Distance from center (positive = next, negative = prev, 0 = center)
   * @returns The point at the specified distance, or null if not reachable
   */
  #getPointAtDistance(centralPoint: ContourPoint, distance: number): ContourPoint | null {
    if (distance === 0) {
      return centralPoint;
    }

    let currentPoint: ContourPoint | null = centralPoint;
    const steps = Math.abs(distance);
    const direction = distance > 0 ? 'next' : 'prev';

    for (let i = 0; i < steps; i++) {
      if (!currentPoint) {
        return null;
      }
      currentPoint = direction === 'next' ? currentPoint.nextPoint : currentPoint.prevPoint;
    }

    return currentPoint;
  }

  #buildPattern(
    point: ContourPoint,
    selectedPoints: Set<ContourPoint>,
    windowSize: number
  ): Pattern {
    if (windowSize % 2 === 0) {
      throw new Error('Window size must be odd to have a central point');
    }

    const halfWindow = Math.floor(windowSize / 2);
    let pattern = '';

    // Build pattern from left to right: [-halfWindow, ..., -1, 0, 1, ..., halfWindow]
    for (let i = -halfWindow; i <= halfWindow; i++) {
      const targetPoint = this.#getPointAtDistance(point, i);
      const isCentral = i === 0;
      pattern += this.#pointPattern(targetPoint, selectedPoints, isCentral);
    }

    return pattern;
  }

  public match(point: ContourPoint, selectedPoints: Set<ContourPoint>): Rule | null {
    for (const windowSize of WINDOW_SIZES) {
      const pattern = this.#buildPattern(point, selectedPoints, windowSize);
      console.log(pattern);
      const rule = this.#ruleTable.get(pattern);
      if (rule) {
        return rule;
      }
    }

    return null;
  }

  /**
   * Public method to build patterns for testing purposes
   * @param point The central point
   * @param selectedPoints Set of selected points
   * @returns Array of patterns for different window sizes
   */
  public buildPatterns(point: ContourPoint, selectedPoints: Set<ContourPoint>): Pattern[] {
    return WINDOW_SIZES.map((windowSize) => this.#buildPattern(point, selectedPoints, windowSize));
  }
}
