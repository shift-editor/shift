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
    // Long code keeps its scrollbar in view, where other panes only show it while scrolling.
    scrollbarColor: "var(--color-control-muted) transparent",
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
  // Hover tooltips share one `.cm-tooltip-hover` box; the lint content inside it has no `.cm-tooltip` class.
  ".cm-tooltip.cm-tooltip-hover:has(> .cm-tooltip-lint)": {
    maxWidth: "520px",
    padding: "0",
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-line-subtle)",
    borderRadius: "6px",
    boxShadow: "0 4px 16px rgb(0 0 0 / 0.12)",
    fontFamily: "var(--font-ui)",
    fontSize: "12px",
  },
  // The border takes the worst problem's colour, as Zed's diagnostic hover does.
  ".cm-tooltip.cm-tooltip-hover:has(.cm-diagnostic-warning)": {
    borderColor: "color-mix(in srgb, var(--color-canvas-orange) 55%, transparent)",
  },
  ".cm-tooltip.cm-tooltip-hover:has(.cm-diagnostic-error)": {
    borderColor: "color-mix(in srgb, var(--color-error) 55%, transparent)",
  },
  ".cm-tooltip-lint .cm-diagnostic": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: "12px",
    rowGap: "4px",
    padding: "6px 10px",
    borderLeft: "none",
    color: "var(--color-primary)",
    whiteSpace: "normal",
  },
  ".cm-tooltip-lint .cm-diagnostic + .cm-diagnostic": {
    borderTop: "1px solid var(--color-line-subtle)",
  },
  // The message (inside CodeMirror's text span) takes the first row; fixes wrap below it.
  ".cm-tooltip-lint .cm-diagnosticText": { flexBasis: "100%" },
  ".cm-fea-diagnostic-source": { color: "var(--color-secondary)" },
  ".cm-fea-diagnostic-rule": {
    color: "inherit",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
  ".cm-fea-diagnostic-rule:hover": { color: "var(--color-primary)" },
  ".cm-tooltip-lint .cm-diagnosticAction": {
    margin: "0",
    padding: "0",
    border: "none",
    borderRadius: "0",
    backgroundColor: "transparent",
    color: "var(--color-accent)",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    cursor: "pointer",
  },
  ".cm-tooltip-lint .cm-diagnosticAction:hover": { textDecoration: "underline" },
  ".cm-fea-generated": {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "20px 16px 32px 8px",
  },
  ".cm-fea-generated-heading": {
    color: "var(--color-secondary)",
    fontStyle: "italic",
  },
  ".cm-fea-lens": {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    height: "18px",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    color: "var(--color-muted)",
  },
  ".cm-fea-lens-action": {
    color: "var(--color-secondary)",
    cursor: "pointer",
  },
  ".cm-fea-lens-action:hover": {
    color: "var(--color-accent)",
    textDecoration: "underline",
  },
  ".cm-fea-generated-code": {
    margin: "0",
    fontFamily: "var(--font-mono)",
    // Follows the code's zoom.
    fontSize: "inherit",
    lineHeight: "inherit",
    whiteSpace: "pre",
    overflowX: "auto",
    // Generated code reads like code but quieter, as IDEs show code that isn't yours to edit.
    opacity: "0.6",
  },
  ".cm-fea-generated-error": {
    boxShadow: "inset 2px 0 0 var(--color-error)",
    paddingLeft: "8px",
    marginLeft: "-10px",
  },
  ".cm-fea-generated-problem": { color: "var(--color-error)", marginLeft: "6px" },
  // A feature switched off still shows, quieter, so it can be turned back on.
  ".cm-fea-generated-off .cm-fea-generated-code": { opacity: "0.3" },
  ".cm-tooltip.cm-tooltip-hover:has(> .cm-fea-class-tooltip)": {
    padding: "0",
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-line-subtle)",
    borderRadius: "6px",
    boxShadow: "0 4px 16px rgb(0 0 0 / 0.12)",
  },
  ".cm-fea-class-tooltip": {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxWidth: "320px",
    padding: "8px 10px",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    color: "var(--color-secondary)",
  },
  ".cm-fea-class-tooltip-title": { fontFamily: "var(--font-mono)", color: "var(--color-primary)" },
  ".cm-fea-class-tooltip-grid": {
    display: "flex",
    flexWrap: "wrap",
    gap: "3px",
    color: "var(--color-primary)",
  },
  // Each glyph sits in its own cell, so a class reads as a grid, as the glyph catalog does.
  ".cm-fea-class-tooltip-grid canvas": {
    width: "28px",
    height: "28px",
    padding: "3px",
    borderRadius: "4px",
    backgroundColor: "var(--color-input)",
  },
  ".cm-fea-fold-placeholder": {
    padding: "0 4px",
    margin: "0 1px",
    borderRadius: "3px",
    backgroundColor: "var(--color-input)",
    color: "var(--color-secondary)",
    cursor: "pointer",
  },
  ".cm-fea-fold-placeholder:hover": {
    color: "var(--color-primary)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-canvas-orange) 25%, transparent)",
  },
});

export const featureCodeTheme = chrome;
