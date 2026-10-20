import type { EditorView } from "@codemirror/view";
import type { Editor } from "@shift/editor";
import type { FeatureDiagnostic, FeatureEdit, GeneratedFeature } from "@shift/types";
import { showFeatureDiagnostics, type FeatureDiagnosticActions } from "./featureDiagnostics";
import { showGeneratedFeatures } from "./generatedBlocks";

/** How long typing pauses before the code is applied to the font. */
const APPLY_DELAY_MS = 400;
/** How long typing pauses before the code is linted; shorter than applying, so problems show first. */
const LINT_DELAY_MS = 150;

/**
 * Keeps a code editor and the font's feature code in step.
 *
 * Typing is linted after a short pause and applied after a longer one, as one
 * "Edit Feature Code" undo step. When the font's feature code changes, its
 * problems are shown again, the compiler's included; a change made elsewhere
 * (undo in the canvas window, say) replaces the editor's text, unless typing
 * is waiting to be applied.
 */
export class FeatureCodeSync {
  readonly #view: EditorView;
  readonly #editor: Editor;
  readonly #onProblems: (diagnostics: readonly FeatureDiagnostic[]) => void;
  readonly #onGenerated: (features: readonly GeneratedFeature[]) => void;
  readonly #actions: FeatureDiagnosticActions;
  /** The code last applied to the font or loaded from it. */
  #applied: string;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #lintTimer: ReturnType<typeof setTimeout> | null = null;
  /** The generated features last shown, redrawn when their problems change. */
  #generated: readonly GeneratedFeature[] = [];
  /** Problems the compiler found inside generated features. */
  #generatedProblems: readonly FeatureDiagnostic[] = [];
  #disposed = false;

  constructor(
    view: EditorView,
    editor: Editor,
    source: string,
    onProblems: (diagnostics: readonly FeatureDiagnostic[]) => void,
    onGenerated: (features: readonly GeneratedFeature[]) => void,
    actions: FeatureDiagnosticActions,
  ) {
    this.#view = view;
    this.#editor = editor;
    this.#applied = source;
    this.#onProblems = onProblems;
    this.#onGenerated = onGenerated;
    this.#actions = actions;
  }

  /** Call when the editor's text changes from typing. */
  edited(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#apply(), APPLY_DELAY_MS);
    if (this.#lintTimer !== null) clearTimeout(this.#lintTimer);
    this.#lintTimer = setTimeout(() => void this.#lint(), LINT_DELAY_MS);
  }

  /** Applies typing that is still waiting, so a save includes it. */
  flush(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#apply();
  }

  /** Lays the code out with the font's settings and applies it as one "Format Feature Code" step. */
  async format(): Promise<void> {
    const before = this.#view.state.doc;
    const formatted = await this.#editor.font.formatFeatureCode(before.toString());
    if (this.#disposed || this.#view.state.doc !== before) return;
    const change = minimalChange(before.toString(), formatted);
    if (!change) return;
    this.#view.dispatch({ changes: change });
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#apply("Format Feature Code");
  }

  /** Call when the font's feature code may have changed. */
  async refresh(): Promise<void> {
    const [source, generated] = await Promise.all([
      this.#editor.font.featureSource(),
      this.#editor.font.generatedFeatures(),
    ]);
    if (this.#disposed) return;
    const code = source ?? "";
    const text = this.#view.state.doc.toString();
    const changedElsewhere = code !== this.#applied && code !== text && this.#timer === null;
    if (changedElsewhere) {
      this.#applied = code;
      this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: code } });
    }
    this.#generated = generated;
    this.#showGenerated();
    this.#onGenerated(generated);
    await this.#lint();
  }

  /** Makes `edits` to the code and applies them at once as one undo step named `label`. */
  applyEdits(edits: readonly FeatureEdit[], label: string): void {
    this.#view.dispatch({
      changes: edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.text })),
    });
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#apply(label);
  }

  /** Copies a generated feature to the end of the code and applies it at once. */
  takeOver(feature: GeneratedFeature): void {
    const end = this.#view.state.doc.length;
    const text = this.#view.state.doc.toString();
    this.#view.dispatch({
      changes: {
        from: end,
        insert: `${separatorAfter(text)}${feature.code}\n`,
      },
    });
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#apply(`Take Over ${feature.tag}`);
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#lintTimer !== null) clearTimeout(this.#lintTimer);
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#apply();
  }

  /** Shows the problems in the editor's text, unless it changes while they are found. */
  async #lint(): Promise<void> {
    this.#lintTimer = null;
    const linted = this.#view.state.doc;
    const diagnostics = await this.#editor.font.lintFeatureCode(linted.toString());
    // Problems point into the text they were found in; newer typing gets its own lint.
    if (this.#disposed || this.#view.state.doc !== linted) return;
    // Problems in generated code are shown on their block, not in the authored text.
    showFeatureDiagnostics(
      this.#view,
      diagnostics.filter((diagnostic) => !diagnostic.generatedTag),
      this.#actions,
    );
    this.#generatedProblems = diagnostics.filter((diagnostic) => diagnostic.generatedTag);
    this.#showGenerated();
    this.#onProblems(diagnostics);
  }

  #showGenerated(): void {
    showGeneratedFeatures(this.#view, this.#generated, this.#generatedProblems, {
      takeOver: (feature) => this.takeOver(feature),
      setOn: (feature, on) =>
        this.#editor.history.capture(`Turn ${on ? "On" : "Off"} ${feature.tag}`, () =>
          this.#editor.font.setGeneratedFeatureOn(feature.tag, on),
        ),
    });
  }

  #apply(label = "Edit Feature Code"): void {
    this.#timer = null;
    const text = this.#view.state.doc.toString();
    if (text === this.#applied) return;
    this.#applied = text;
    this.#editor.history.capture(label, () =>
      this.#editor.font.setFeatureSource(text === "" ? null : text),
    );
  }
}

/** What goes between existing code and an appended block: nothing, or enough for a blank line. */
function separatorAfter(text: string): string {
  if (text.trim() === "") return "";
  if (text.endsWith("\n")) return "\n";
  return "\n\n";
}

/** The one replacement that turns `before` into `after`, keeping their shared start and end; null when they match. */
function minimalChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < shorter - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}
