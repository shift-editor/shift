/** Characters kept from the end of the stem when the middle of a name is cut. */
const TAIL_STEM_CHARACTERS = 4;

/** A filename split before its extension, so the two can be styled apart. */
export type FilenameParts = {
  stem: string;
  /** The extension with its dot, as `.shift`; empty when the name has none. */
  extension: string;
};

/** Splits `MutatorSans.designspace` into `MutatorSans` and `.designspace`. */
export function filenameParts(name: string): FilenameParts {
  const extensionIndex = name.lastIndexOf(".");
  if (extensionIndex <= 0) return { stem: name, extension: "" };

  return { stem: name.slice(0, extensionIndex), extension: name.slice(extensionIndex) };
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

/**
 * Returns `name` when it fits, else its longest middle truncation that fits,
 * else the shortest one.
 *
 * @param fits - Whether a candidate label fits the space it is drawn in.
 */
export function longestFittingName(name: string, fits: (label: string) => boolean): string {
  if (fits(name)) return name;

  let low = 0;
  let high = middleTruncationLimit(name) - 1;
  let best = 0;
  while (low <= high) {
    const headLength = Math.floor((low + high) / 2);
    if (fits(middleTruncatedName(name, headLength))) {
      best = headLength;
      low = headLength + 1;
    } else {
      high = headLength - 1;
    }
  }
  return middleTruncatedName(name, best);
}
