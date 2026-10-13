import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const KEYWORDS = new Set([
  "feature",
  "lookup",
  "languagesystem",
  "script",
  "language",
  "lookupflag",
  "sub",
  "substitute",
  "by",
  "from",
  "pos",
  "position",
  "enum",
  "enumerate",
  "ignore",
  "rsub",
  "reversesub",
  "markClass",
  "anchor",
  "mark",
  "base",
  "ligature",
  "cursive",
  "table",
  "include",
  "useExtension",
  "exclude_dflt",
  "include_dflt",
  "required",
  "subtable",
  "parameters",
  "featureNames",
  "name",
  "sizemenuname",
  "cvParameters",
  "conditionset",
  "variation",
  "NULL",
  "RightToLeft",
  "IgnoreBaseGlyphs",
  "IgnoreLigatures",
  "IgnoreMarks",
  "MarkAttachmentType",
  "UseMarkFilteringSet",
]);

type TokenKind = "comment" | "string" | "class" | "number" | "keyword" | "mark";

const MARKS: Record<TokenKind, Decoration> = {
  comment: Decoration.mark({ class: "cm-fea-comment" }),
  string: Decoration.mark({ class: "cm-fea-string" }),
  class: Decoration.mark({ class: "cm-fea-class" }),
  number: Decoration.mark({ class: "cm-fea-number" }),
  keyword: Decoration.mark({ class: "cm-fea-keyword" }),
  mark: Decoration.mark({ class: "cm-fea-mark" }),
};

const TOKEN =
  /(#.*)|("[^"]*"?)|(@[A-Za-z0-9_.-]+)|(-?\d+(?:\.\d+)?\b)|(\\?[A-Za-z_.][A-Za-z0-9_.-]*)|(')/g;

/** The kind of the token `match` found; glyph names have none and stay plain. */
function tokenKind(match: RegExpExecArray): TokenKind | null {
  if (match[1]) return "comment";
  if (match[2]) return "string";
  if (match[3]) return "class";
  if (match[4]) return "number";
  if (match[5]) return KEYWORDS.has(match[5]) ? "keyword" : null;
  if (match[6]) return "mark";
  return null;
}

/**
 * Colours only the lines on screen. Every `.fea` token ends on the line it
 * starts on, so a line needs nothing from the lines above it, and jumping
 * deep into a long file colours at once.
 */
function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let position = from; position <= to; ) {
      const line = view.state.doc.lineAt(position);
      for (const match of line.text.matchAll(TOKEN)) {
        const kind = tokenKind(match);
        if (!kind) continue;
        const start = line.from + match.index;
        builder.add(start, start + match[0].length, MARKS[kind]);
      }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

export const feaHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
