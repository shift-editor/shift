import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { FeatureDiagnostic } from "@shift/types";

/** Shows a problem's message after the end of its line, as editors with inline errors do. */
class InlineMessage extends WidgetType {
  constructor(
    readonly message: string,
    readonly severity: Diagnostic["severity"],
  ) {
    super();
  }

  override eq(other: InlineMessage): boolean {
    return other.message === this.message && other.severity === this.severity;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-fea-inline cm-fea-inline-${this.severity}`;
    span.textContent = this.message;
    return span;
  }
}

const setInlineMessages = StateEffect.define<DecorationSet>();

const inlineMessages = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(messages, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setInlineMessages)) continue;
      // A CodeMirror state effect's payload, not a reactive signal.
      const { value: replacement } = effect;
      return replacement;
    }
    return messages.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Underlines, gutter marks, and inline messages for the compiler's problems. */
export const featureDiagnostics = [lintGutter(), inlineMessages];

/**
 * Shows `diagnostics` in `view`: each problem underlined with its message on
 * hover, marked in the gutter, and the first problem on each line written
 * after the line's end.
 */
export function showFeatureDiagnostics(
  view: EditorView,
  diagnostics: readonly FeatureDiagnostic[],
): void {
  const length = view.state.doc.length;
  const lint: Diagnostic[] = diagnostics.map((diagnostic) => ({
    from: Math.min(diagnostic.from, length),
    to: Math.min(Math.max(diagnostic.to, diagnostic.from), length),
    severity: diagnostic.severity,
    message: diagnostic.message,
  }));
  view.dispatch(setDiagnostics(view.state, lint), {
    effects: setInlineMessages.of(inlineDecorations(view.state, lint)),
  });
}

function inlineDecorations(state: EditorState, diagnostics: readonly Diagnostic[]): DecorationSet {
  const shown = new Set<number>();
  const widgets: Range<Decoration>[] = [];
  for (const diagnostic of diagnostics) {
    const line = state.doc.lineAt(diagnostic.from);
    if (shown.has(line.number)) continue;
    shown.add(line.number);
    const widget = new InlineMessage(diagnostic.message, diagnostic.severity);
    widgets.push(Decoration.widget({ widget, side: 1 }).range(line.to));
  }
  return Decoration.set(widgets, true);
}
