/**
 * Pattern Parser - Expands pattern templates into concrete patterns
 *
 * Pattern syntax:
 * - N = No point (edge of contour)
 * - C = Corner (on-curve, not smooth)
 * - S = Smooth (on-curve, smooth)
 * - H = Handle (off-curve)
 * - @ = Selected point
 * - X = Any point (expands to N, C, S, H)
 * - [CS] = Set notation (expands to C and S)
 */

// Token constants
export const TOKEN_NO_POINT = "N";
export const TOKEN_CORNER = "C";
export const TOKEN_HANDLE = "H";
export const TOKEN_SMOOTH = "S";
export const TOKEN_SELECTED = "@";
export const TOKEN_ANY = "X";
export const TOKEN_SET_START = "[";
export const TOKEN_SET_END = "]";

const ALL_POINT_TOKENS = [TOKEN_NO_POINT, TOKEN_CORNER, TOKEN_SMOOTH, TOKEN_HANDLE];

/**
 * Compute cartesian product of character sets
 */
function cartesianProduct(sets: string[][]): string[] {
  if (sets.length === 0) {
    return [""];
  }

  let result: string[] = [""];

  for (const set of sets) {
    const newResult: string[] = [];
    for (const prefix of result) {
      for (const ch of set) {
        newResult.push(prefix + ch);
      }
    }
    result = newResult;
  }

  return result;
}

/**
 * Parse a set notation [CS] and return the characters and end index
 */
function parseSet(pattern: string, startIndex: number): { chars: string[]; endIndex: number } {
  const chars: string[] = [];
  let i = startIndex + 1; // Skip opening bracket

  while (i < pattern.length && pattern[i] !== TOKEN_SET_END) {
    if (pattern[i] === TOKEN_ANY) {
      chars.push(...ALL_POINT_TOKENS);
    } else {
      chars.push(pattern[i]);
    }
    i++;
  }

  return { chars, endIndex: i + 1 }; // +1 to skip closing bracket
}

/**
 * Expand a pattern template into all concrete patterns
 *
 * @example
 * expandPattern("[CS]H") // ["CH", "SH"]
 * expandPattern("H[CS]H") // ["HCH", "HSH"]
 * expandPattern("[X@][CS]H") // ["NCH", "CCH", "SCH", "HCH", "@CH", "NSH", ...]
 */
export function expandPattern(pattern: string): string[] {
  const sets: string[][] = [];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === TOKEN_SET_START) {
      const { chars, endIndex } = parseSet(pattern, i);
      if (chars.length === 0) {
        return [];
      }
      sets.push(chars);
      i = endIndex;
    } else if (ch === TOKEN_ANY) {
      sets.push([...ALL_POINT_TOKENS]);
      i++;
    } else {
      sets.push([ch]);
      i++;
    }
  }

  return cartesianProduct(sets).filter((s) => s.length > 0);
}
