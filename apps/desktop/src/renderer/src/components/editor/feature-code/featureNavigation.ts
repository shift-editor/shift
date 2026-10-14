import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Editor } from "@shift/editor";
import type { FeatureRange, FeatureSymbol } from "@shift/types";

/** What navigation shows outside the code: lists, the rename box, and glyphs. */
export interface FeatureNavigationHost {
  /** Lists where a symbol is defined and used. */
  readonly showReferences: (symbol: FeatureSymbol) => void;
  /** Asks for a new name for the symbol at `offset`. */
  readonly startRename: (symbol: FeatureSymbol, offset: number) => void;
  /** Opens a glyph from the font in the canvas. */
  readonly openGlyph: (name: string) => void;
}

/**
 * Go to definition, find references, and rename for feature code: F12 and
 * ⌘-click (Ctrl-click elsewhere) go to the name's definition, or open a glyph
 * in the canvas; ⇧F12 lists every place it's written; F2 renames a class or lookup.
 */
export function featureNavigation(
  editor: Editor,
  host: () => FeatureNavigationHost,
  isMac: boolean,
): Extension {
  const at = (view: EditorView) => view.state.selection.main.head;
  return [
    keymap.of([
      { key: "F12", run: (view) => (void goToDefinition(view, editor, at(view), host()), true) },
      {
        key: "Shift-F12",
        run: (view) => (void findReferences(view, editor, at(view), host()), true),
      },
      { key: "F2", run: (view) => (void rename(view, editor, at(view), host()), true) },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const modified = isMac ? event.metaKey : event.ctrlKey;
        if (!modified || event.button !== 0) return false;
        const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (offset === null) return false;
        event.preventDefault();
        void goToDefinition(view, editor, offset, host());
        return true;
      },
    }),
  ];
}

/** Selects `range` and scrolls it to the middle of the code. */
export function revealRange(view: EditorView, range: FeatureRange): void {
  const end = view.state.doc.length;
  const from = Math.min(range.from, end);
  view.dispatch({
    selection: { anchor: from, head: Math.min(range.to, end) },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
  view.focus();
}

/** The symbol at `offset`, unless the code changes while it is looked up. */
async function symbolAt(
  view: EditorView,
  editor: Editor,
  offset: number,
): Promise<FeatureSymbol | null> {
  const doc = view.state.doc;
  const symbol = await editor.font.featureSymbolAt(doc.toString(), offset);
  return view.state.doc === doc ? symbol : null;
}

async function goToDefinition(
  view: EditorView,
  editor: Editor,
  offset: number,
  host: FeatureNavigationHost,
): Promise<void> {
  const symbol = await symbolAt(view, editor, offset);
  if (!symbol) return;
  if (symbol.kind === "glyph") return host.openGlyph(symbol.name);
  const [only, ...others] = symbol.definitions;
  if (only && others.length === 0) return revealRange(view, only);
  // A mark class has a definition per statement, and an undefined name has none: list them.
  host.showReferences(symbol);
}

async function findReferences(
  view: EditorView,
  editor: Editor,
  offset: number,
  host: FeatureNavigationHost,
): Promise<void> {
  const symbol = await symbolAt(view, editor, offset);
  if (symbol) host.showReferences(symbol);
}

async function rename(
  view: EditorView,
  editor: Editor,
  offset: number,
  host: FeatureNavigationHost,
): Promise<void> {
  const symbol = await symbolAt(view, editor, offset);
  if (symbol && symbol.kind !== "glyph") host.startRename(symbol, offset);
}
