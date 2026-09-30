/** Characters kept from the end of the stem when the middle of a name is cut. */
const TAIL_STEM_CHARACTERS = 4;

/**
 * Splits a filename so it wraps before `.` and after `-` or `_`, as in
 * `MutatorSans` / `.designspace`.
 */
export function filenameWrapChunks(name: string): string[] {
  return name.split(/(?<=[-_])|(?=\.)/).filter((chunk) => chunk.length > 0);
}

/**
 * Number of leading characters a middle-truncated name can keep before it
 * would reach the preserved tail; keeping this many or more leaves it whole.
 */
export function middleTruncationLimit(name: string): number {
  const extensionIndex = name.lastIndexOf(".");
  const stemEnd = extensionIndex > 0 ? extensionIndex : name.length;
  return Math.max(0, stemEnd - TAIL_STEM_CHARACTERS);
}

/**
 * Replaces the middle of a filename with an ellipsis, keeping its first
 * `headLength` characters plus the end of the stem and the extension, as
 * Finder does: `OpenSans-Cond…alic.shift`.
 */
export function middleTruncatedName(name: string, headLength: number): string {
  const tailStart = middleTruncationLimit(name);
  if (headLength >= tailStart) return name;

  return `${name.slice(0, headLength).trimEnd()}…${name.slice(tailStart)}`;
}
