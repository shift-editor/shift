import { hoverTooltip, type EditorView } from "@codemirror/view";
import type { Editor } from "@shift/editor";
import { effect } from "@shift/editor/signals";
import type { GlyphId, GlyphName } from "@shift/types";
import { drawThumbnail } from "@/components/kerning/groups/GlyphThumbnail";

/** Glyphs drawn at most; a class of every lowercase letter still shows its size. */
const MAX_SHOWN = 48;

/**
 * Hovering a glyph class (`@lowercase`) shows its glyphs drawn as small
 * thumbnails, with their count, so a class can be checked without finding
 * its definition.
 */
export function classHover(editor: Editor) {
  return hoverTooltip(async (view, pos) => {
    const text = view.state.doc.toString();
    const symbol = await editor.font.featureSymbolAt(text, pos);
    if (!symbol || symbol.kind !== "class" || view.state.doc.toString() !== text) return null;
    const definition = symbol.definitions[0];
    if (!definition) return null;
    const names = classMembers(
      text,
      definition.to,
      new Set([symbol.name]),
      (name) => editor.font.entryForName(name as GlyphName) !== null,
    );
    const ids = names
      .map((name) => editor.font.entryForName(name as GlyphName)?.id ?? null)
      .filter((id): id is GlyphId => id !== null);
    await editor.font.loadGlyphs(ids.slice(0, MAX_SHOWN));
    const occurrence = [...symbol.definitions, ...symbol.references].find(
      (range) => range.from <= pos && pos <= range.to,
    );
    return {
      pos: occurrence?.from ?? pos,
      end: occurrence?.to ?? pos,
      above: true,
      create: (tooltipView) => classTooltip(tooltipView, editor, symbol.name, names, ids),
    };
  });
}

/**
 * The glyph names a class definition lists, starting after its name at
 * `after`; nested classes defined earlier in `text` are expanded once each.
 */
export function classMembers(
  text: string,
  after: number,
  seen: Set<string>,
  isGlyph: (name: string) => boolean = () => false,
): string[] {
  const end = text.indexOf(";", after);
  const body = text.slice(after, end === -1 ? undefined : end).replace(/^\s*=\s*/, "");
  // `A - Z` is a range; spaces around the hyphen keep it apart from names like `beh-ar`.
  const tokens = body
    .replace(/[[\]]/g, " ")
    .replace(/\s+-\s+/g, " - ")
    .split(/\s+/)
    .filter(Boolean);
  const members: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (tokens[index + 1] === "-" && tokens[index + 2]) {
      members.push(...glyphRange(token, tokens[index + 2]!));
      index += 2;
      continue;
    }
    const joined = /^([^-]+)-([^-]+)$/.exec(token);
    if (joined && !isGlyph(token)) {
      members.push(...glyphRange(joined[1]!, joined[2]!));
      continue;
    }
    if (!token.startsWith("@")) {
      members.push(token.replace(/^\\/, ""));
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    const nested = new RegExp(`${escapeRegExp(token)}\\s*=`).exec(text);
    if (nested) members.push(...classMembers(text, nested.index + token.length, seen, isGlyph));
  }
  return members;
}

/**
 * The names an FEA glyph range covers: names that differ in one run of
 * letters or digits (`a - z`, `a.sc - e.sc`, `one.0 - one.9`), as the
 * specification allows. Anything else is kept as its two ends.
 */
export function glyphRange(first: string, last: string): string[] {
  if (first.length !== last.length) return [first, last];
  let start = 0;
  while (start < first.length && first[start] === last[start]) start++;
  let stop = first.length;
  while (stop > start && first[stop - 1] === last[stop - 1]) stop--;
  const from = first.slice(start, stop);
  const to = last.slice(start, stop);
  const prefix = first.slice(0, start);
  const suffix = first.slice(stop);
  if (/^\d+$/.test(from) && /^\d+$/.test(to)) {
    const names: string[] = [];
    for (let value = Number(from); value <= Number(to); value++) {
      names.push(`${prefix}${String(value).padStart(from.length, "0")}${suffix}`);
    }
    return names;
  }
  if (from.length === 1 && /[A-Za-z]/.test(from) && /[A-Za-z]/.test(to)) {
    const names: string[] = [];
    for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code++) {
      names.push(`${prefix}${String.fromCharCode(code)}${suffix}`);
    }
    return names;
  }
  return [first, last];
}

function classTooltip(
  view: EditorView,
  editor: Editor,
  name: string,
  names: readonly string[],
  ids: readonly GlyphId[],
) {
  const doc = view.dom.ownerDocument;
  const dom = doc.createElement("div");
  dom.className = "cm-fea-class-tooltip";
  const title = doc.createElement("div");
  title.className = "cm-fea-class-tooltip-title";
  const count = names.length === 1 ? "1 glyph" : `${names.length} glyphs`;
  title.textContent = `${name} · ${count}`;
  const grid = doc.createElement("div");
  grid.className = "cm-fea-class-tooltip-grid";
  const subscriptions = ids.slice(0, MAX_SHOWN).map((id, index) => {
    const canvas = doc.createElement("canvas");
    canvas.title = names[index] ?? "";
    grid.append(canvas);
    return effect(() => drawThumbnail(canvas, editor, id));
  });
  dom.append(title, grid);
  const hidden = names.length - Math.min(ids.length, MAX_SHOWN);
  if (hidden > 0) {
    const more = doc.createElement("div");
    more.className = "cm-fea-class-tooltip-more";
    more.textContent = `${hidden} more`;
    dom.append(more);
  }
  return {
    dom,
    destroy: () => subscriptions.forEach((subscription) => subscription.dispose()),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
