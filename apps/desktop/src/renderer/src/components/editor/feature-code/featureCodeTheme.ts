import { EditorView } from "@codemirror/view";

/**
 * Shift's look for the feature code editor, from the app's theme tokens so it
 * follows every colour theme: the panel's surface, a quiet gutter, compact
 * mono type, and a restrained palette where glyph names read as plain text
 * (token classes come from `feaHighlighting`).
 */
const chrome = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    color: "var(--color-primary)",
    backgroundColor: "var(--color-surface)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "20px",
    scrollbarWidth: "thin",
  },
  ".cm-content": { padding: "8px 0", caretColor: "var(--color-accent)" },
  ".cm-line": { padding: "0 16px 0 8px" },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-icon-subtle)",
    border: "none",
    fontSize: "11px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "28px",
    padding: "0 4px 0 12px",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-hover) 45%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-primary)" },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "transparent",
    outline: "1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)",
    borderRadius: "2px",
  },
  ".cm-panels": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-primary)",
    fontFamily: "var(--font-ui)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--color-line-subtle)" },
  ".cm-fea-keyword": { color: "var(--color-canvas-purple)", fontWeight: "500" },
  ".cm-fea-class": { color: "var(--color-accent)" },
  ".cm-fea-number": { color: "var(--color-canvas-orange)" },
  ".cm-fea-string": { color: "var(--color-canvas-green)" },
  ".cm-fea-comment": { color: "var(--color-secondary)", fontStyle: "italic" },
  ".cm-fea-mark": { color: "var(--color-canvas-orange)", fontWeight: "600" },
  ".cm-foldGutter .cm-gutterElement": {
    color: "var(--color-muted)",
    padding: "0 4px",
    cursor: "pointer",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--color-input)",
    border: "none",
    color: "var(--color-secondary)",
    padding: "0 4px",
    borderRadius: "3px",
  },
  ".cm-fea-inline": {
    paddingLeft: "16px",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
  },
  ".cm-fea-inline-error": { color: "var(--color-error)" },
  ".cm-fea-inline-warning": { color: "var(--color-canvas-orange)" },
  ".cm-fea-inline-info": { color: "var(--color-secondary)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline dotted var(--color-error)",
    textUnderlineOffset: "3px",
    textDecorationThickness: "1.5px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline dotted var(--color-canvas-orange)",
    textUnderlineOffset: "3px",
    textDecorationThickness: "1.5px",
  },
  ".cm-gutter-lint": { width: "12px" },
  ".cm-tooltip.cm-tooltip-lint": {
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-line-subtle)",
    borderRadius: "6px",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-canvas-orange) 25%, transparent)",
  },
});

export const featureCodeTheme = chrome;
