const LOREM =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum";
const OTHER_COMPOSITES = ["ü", "ú", "ù", "ū", "ǘ", "ǚ"];

/**
 * Returns about `count` characters of lorem for `fixtures/fonts/AnchorDragBench.glyphs`.
 *
 * @remarks
 * Every 4th letter is `ǖ` and every 13th another composite on `u`, so most of
 * the text is built on `u`. Lines break at the first space after 80 columns.
 * The text is deterministic, so measurements at one count compare.
 */
export function proofText(count: number): string {
  let text = "";
  let letters = 0;
  let column = 0;
  for (let index = 0; text.length < count; index++) {
    let char = LOREM[index % LOREM.length]!;
    if (char !== " ") {
      letters++;
      if (letters % 4 === 0) char = "ǖ";
      else if (letters % 13 === 0) char = OTHER_COMPOSITES[letters % OTHER_COMPOSITES.length]!;
    }
    if (column >= 80 && char === " ") {
      text += "\n";
      column = 0;
      continue;
    }
    text += char;
    column++;
  }
  return text;
}
