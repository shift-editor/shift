import { ContourPoint } from './Contour';
import { Pattern } from './RuleTable';

// Token types
const TOKENS = {
  NO_POINT: 'N',
  CORNER: 'C',
  HANDLE: 'H',
  SMOOTH: 'S',
  SELECTED_POINT: '@',
  ALL: 'X',
  SET_START: '[',
  SET_END: ']',
} as const;

type Token = (typeof TOKENS)[keyof typeof TOKENS];

const ALL_POINT_TOKENS = [TOKENS.NO_POINT, TOKENS.CORNER, TOKENS.SMOOTH, TOKENS.HANDLE];

export const BuildPattern = (point: ContourPoint, selectedPoints: Set<ContourPoint>) => {
  let pattern = '';

  const pointPattern = (
    point: ContourPoint | null,
    centralPoint: boolean,
    selectedPoints: Set<ContourPoint>
  ) => {
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
  };

  pattern += pointPattern(point.prevPoint, false, selectedPoints);
  pattern += pointPattern(point, true, selectedPoints);
  pattern += pointPattern(point.nextPoint, false, selectedPoints);

  return pattern;
};

export class PatternParser {
  /**
   * Generates the cartesian product of multiple arrays
   * @param sets Arrays to combine
   * @returns Array of all possible combinations
   */
  #cartesianProduct<T>(...sets: T[][]): T[][] {
    return sets.reduce<T[][]>(
      (acc, current) =>
        acc.flatMap((accElement) =>
          current.map((currentElement) => [...accElement, currentElement])
        ),
      [[]]
    );
  }

  /**
   * Parses a character set (e.g., [NH])
   * @param pattern The pattern string
   * @param startIndex Start index of the set
   * @returns Tuple of [parsed set, new index]
   */
  #parseSet(pattern: string, startIndex: number): [Token[], number] {
    const set: Token[] = [];
    let i = startIndex + 1; // Skip the opening bracket

    while (i < pattern.length && pattern[i] !== TOKENS.SET_END) {
      if (pattern[i] === TOKENS.ALL) {
        set.push(...ALL_POINT_TOKENS);
      } else {
        set.push(pattern[i] as Token);
      }
      i++;
    }

    // If set is empty, return empty array
    if (set.length === 0) {
      return [[], i + 1];
    }

    return [set, i + 1]; // +1 to skip the closing bracket
  }

  /**
   * Expands a pattern string into all possible combinations
   * @param pattern The pattern string to expand
   * @returns Array of expanded patterns
   */
  expand(pattern: string): Pattern[] {
    const sets: Token[][] = [];
    let i = 0;

    while (i < pattern.length) {
      const token = pattern[i] as Token;

      switch (token) {
        case TOKENS.SET_START: {
          const [set, newIndex] = this.#parseSet(pattern, i);
          if (set.length > 0) {
            sets.push(set);
          } else {
            // For empty sets, return empty array
            return [];
          }
          i = newIndex;
          break;
        }
        case TOKENS.ALL: {
          sets.push([...ALL_POINT_TOKENS]);
          i++;
          break;
        }
        default:
          sets.push([token]);
          i++;
          break;
      }
    }

    const combinations = this.#cartesianProduct(...sets);
    return combinations.map((pattern) => pattern.join('')).filter(Boolean);
  }
}
