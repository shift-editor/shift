import type { EditorView } from "@codemirror/view";
import type { Editor } from "@shift/editor";
import type { FeatureDiagnostic } from "@shift/types";
import { showFeatureDiagnostics } from "./featureDiagnostics";

/** How long typing pauses before the code is applied to the font. */
const APPLY_DELAY_MS = 400;

/**
 * Keeps a code editor and the font's feature code in step.
 *
 * Typing applies the code after a pause, as one "Edit Feature Code" undo
 * step. When the font's feature code changes, the compiler's problems are
 * shown for it; a change made elsewhere (undo in the canvas window, say)
 * replaces the editor's text, unless typing is waiting to be applied.
 */
export class FeatureCodeSync {
  readonly #view: EditorView;
  readonly #editor: Editor;
  readonly #onProblems: (diagnostics: readonly FeatureDiagnostic[]) => void;
  /** The code last applied to the font or loaded from it. */
  #applied: string;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(
    view: EditorView,
    editor: Editor,
    source: string,
    onProblems: (diagnostics: readonly FeatureDiagnostic[]) => void,
  ) {
    this.#view = view;
    this.#editor = editor;
    this.#applied = source;
    this.#onProblems = onProblems;
  }

  /** Call when the editor's text changes from typing. */
  edited(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#apply(), APPLY_DELAY_MS);
  }

  /** Call when the font's feature code may have changed. */
  async refresh(): Promise<void> {
    const [source, diagnostics] = await Promise.all([
      this.#editor.font.featureSource(),
      this.#editor.font.featureDiagnostics(),
    ]);
    if (this.#disposed) return;
    const code = source ?? "";
    const text = this.#view.state.doc.toString();
    const changedElsewhere = code !== this.#applied && code !== text && this.#timer === null;
    if (changedElsewhere) {
      this.#applied = code;
      this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: code } });
    }
    // Problems point into the code they were found in; skip them while newer typing waits.
    if (code !== this.#view.state.doc.toString()) return;
    showFeatureDiagnostics(this.#view, diagnostics);
    this.#onProblems(diagnostics);
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#apply();
  }

  #apply(): void {
    this.#timer = null;
    const text = this.#view.state.doc.toString();
    if (text === this.#applied) return;
    this.#applied = text;
    this.#editor.history.capture("Edit Feature Code", () =>
      this.#editor.font.setFeatureSource(text === "" ? null : text),
    );
  }
}
