import { foldGutter, foldService } from "@codemirror/language";

const OPENERS: Record<string, string> = { "{": "}", "[": "]" };

/**
 * Folds a block or class that opens at the end of a line, `feature liga {`
 * or `@Numeral = [ zero`, up to its matching closer. The tokenizer has no
 * syntax tree, so folding pairs brackets outside comments.
 */
const bracketFolding = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.sliceString(lineStart, lineEnd).replace(/#.*/, "");
  const openAt = Math.max(line.lastIndexOf("{"), line.lastIndexOf("["));
  if (openAt === -1) return null;
  const open = line[openAt]!;
  const close = OPENERS[open]!;

  let depth = 0;
  let inComment = false;
  const text = state.doc.sliceString(lineStart + openAt);
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "\n") inComment = false;
    else if (char === "#") inComment = true;
    if (inComment) continue;
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) {
      const end = lineStart + openAt + index;
      return end > lineEnd ? { from: lineStart + openAt + 1, to: end } : null;
    }
  }
  return null;
});

export const featureFolding = [bracketFolding, foldGutter({ openText: "⌄", closedText: "›" })];
