import { setDiagnostics, type Action, type Diagnostic } from "@codemirror/lint";
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

/**
 * Underlines and inline messages for problems in the code. Like Zed and VS
 * Code there are no gutter marks: CodeMirror's gutter hover also listens on the
 * opener window, so in a tool window it never closes.
 */
export const featureDiagnostics = [inlineMessages];

/** What a problem's hover offers beyond its fixes. */
export interface FeatureDiagnosticActions {
  /** Stops reporting a lint rule for this font. */
  readonly onIgnore: (rule: string) => void;
}

/**
 * Shows `diagnostics`, found in the editor's current text, in `view`: each
 * problem underlined with its message, rule, and quick fixes on hover, and
 * the first problem on each line written after the line's end.
 */
export function showFeatureDiagnostics(
  view: EditorView,
  diagnostics: readonly FeatureDiagnostic[],
  actions?: FeatureDiagnosticActions,
): void {
  const length = view.state.doc.length;
  const linted = view.state.doc;
  const lint: Diagnostic[] = diagnostics.map((diagnostic) => {
    const rule = diagnostic.rule ?? undefined;
    const fixes: Action[] = diagnostic.fixes.map((fix) => ({
      name: fix.safe ? fix.title : `${fix.title} (unsafe)`,
      apply: (target) => {
        // Fix offsets point into the text that was linted; any edit since makes them stale.
        if (target.state.doc !== linted) return;
        const changes = fix.edits.map((edit) => ({
          from: edit.from,
          to: edit.to,
          insert: edit.text,
        }));
        target.dispatch({ changes });
      },
    }));
    const ruleActions: Action[] =
      rule && actions ? [{ name: `Ignore ${rule}`, apply: () => actions.onIgnore(rule) }] : [];
    return {
      from: Math.min(diagnostic.from, length),
      to: Math.min(Math.max(diagnostic.to, diagnostic.from), length),
      severity: diagnostic.severity,
      message: diagnostic.message,
      renderMessage: (view) => messageElement(view, diagnostic.message, rule),
      actions: [...fixes, ...ruleActions],
    };
  });
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

/**
 * A problem's message followed by where it came from, as Zed writes it:
 * `… (Feanor T001)`, the rule a link to its documentation.
 */
function messageElement(view: EditorView, message: string, rule: string | undefined): Node {
  const doc = view.dom.ownerDocument;
  const root = doc.createElement("div");
  root.className = "cm-fea-diagnostic-message";
  root.append(message);
  if (!rule) return root;
  const source = doc.createElement("span");
  source.className = "cm-fea-diagnostic-source";
  const link = doc.createElement("button");
  link.type = "button";
  link.className = "cm-fea-diagnostic-rule";
  link.textContent = rule;
  link.title = `Open the documentation for ${rule}`;
  link.addEventListener("click", () => openRuleDocumentation(rule));
  source.append(" (Feanor ", link, ")");
  root.append(source);
  return root;
}

/** Where a Feanor rule is documented. */
export function ruleDocumentationUrl(rule: string): string {
  return `https://github.com/shift-editor/feanor/blob/main/crates/feanor/rules/${encodeURIComponent(rule)}.md`;
}

/** Opens a rule's documentation in the browser. */
export function openRuleDocumentation(rule: string): void {
  // The document window opens Shift's documentation links in the browser.
  window.open(ruleDocumentationUrl(rule), "_blank", "noopener");
}
