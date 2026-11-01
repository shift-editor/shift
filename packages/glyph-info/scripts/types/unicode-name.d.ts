// unicode-name ships JavaScript only; this declares the one export the search
// generator calls, as its JSDoc documents it.
declare module "unicode-name" {
  /** Returns the Unicode name of a character or codepoint, or undefined when it has none. */
  export function unicodeName(char: string | number): string | undefined;
}
