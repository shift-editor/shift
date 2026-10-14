import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { FeatureDiagnostic, GeneratedFeature } from "@shift/types";
import { appendHighlightedLine } from "./feaHighlighting";

/** What a generated block's CodeLens can do. */
export interface GeneratedFeatureActions {
  /** Copies a generated feature into the authored code. */
  readonly takeOver: (feature: GeneratedFeature) => void;
  /** Switches a generated feature on or off. */
  readonly setOn: (feature: GeneratedFeature, on: boolean) => void;
}

/**
 * The features glyph names generate, shown after the code as IDEs show
 * generated code: a comment heading the section, then each feature as a
 * dimmed, read-only fold (`feature sups { … } sups;`) with a CodeLens line
 * above it to unfold it or take it over as code.
 */
class GeneratedBlocks extends WidgetType {
  constructor(
    readonly features: readonly GeneratedFeature[],
    /** Compiler problems inside these features, ranges relative to each feature's code. */
    readonly problems: readonly FeatureDiagnostic[],
    readonly actions: GeneratedFeatureActions,
  ) {
    super();
  }

  override eq(other: GeneratedBlocks): boolean {
    return (
      other.features.length === this.features.length &&
      other.features.every((feature, index) => {
        const mine = this.features[index];
        return feature.code === mine?.code && feature.on === mine.on;
      }) &&
      problemKey(other.problems) === problemKey(this.problems)
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument;
    const root = doc.createElement("div");
    root.className = "cm-fea-generated";
    const heading = doc.createElement("div");
    heading.className = "cm-fea-generated-heading";
    heading.textContent =
      "# Generated from glyph names. Write a feature in your code to replace one.";
    root.append(heading);
    for (const feature of this.features) root.append(this.#block(doc, feature));
    return root;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  #block(doc: Document, feature: GeneratedFeature): HTMLElement {
    const block = doc.createElement("section");
    const problems = this.problems.filter((problem) => problem.generatedTag === feature.tag);
    block.className = feature.on
      ? "cm-fea-generated-block"
      : "cm-fea-generated-block cm-fea-generated-off";
    if (problems.length > 0) block.classList.add("cm-fea-generated-error");
    block.dataset.generatedTag = feature.tag;
    block.setAttribute("aria-label", `${feature.tag}, generated`);

    const code = doc.createElement("pre");
    code.className = "cm-fea-generated-code";
    const lines = feature.code.split("\n");
    const toggle = this.#lensAction(doc, "Show rules", () => setOpen(code.dataset.open !== "true"));
    const setOpen = (open: boolean) => {
      code.dataset.open = String(open);
      code.replaceChildren(
        ...(open ? this.#lines(doc, lines) : [this.#fold(doc, lines, () => setOpen(true))]),
      );
      toggle.textContent = open ? "Hide rules" : "Show rules";
      toggle.setAttribute("aria-expanded", String(open));
    };
    setOpen(false);

    const lens = doc.createElement("div");
    lens.className = "cm-fea-lens";
    const rules = doc.createElement("span");
    const count = feature.rules === 1 ? "1 rule" : `${feature.rules} rules`;
    rules.textContent = feature.on ? count : `Off · ${count}`;
    const takeOver = this.#lensAction(doc, "Take over", () => this.actions.takeOver(feature));
    takeOver.title = `Copy ${feature.tag} into your code to edit it; it stops following glyph names`;
    const onOff = this.#lensAction(doc, feature.on ? "Turn off" : "Turn on", () =>
      this.actions.setOn(feature, !feature.on),
    );
    onOff.title = feature.on
      ? `Stop compiling ${feature.tag}; it stays here to turn back on`
      : `Compile ${feature.tag} again`;
    lens.append(rules, separator(doc), toggle, separator(doc), onOff, separator(doc), takeOver);
    const [first] = problems;
    if (first) {
      const problem = doc.createElement("span");
      problem.className = "cm-fea-generated-problem";
      problem.textContent =
        problems.length === 1 ? first.message : `${first.message} (+${problems.length - 1} more)`;
      lens.append(problem);
    }

    block.append(lens, code);
    return block;
  }

  /** The feature folded to one line, its body replaced by a `…` that unfolds it. */
  #fold(doc: Document, lines: readonly string[], unfold: () => void): HTMLElement {
    const row = doc.createElement("div");
    appendHighlightedLine(row, `${lines[0] ?? ""} `);
    const placeholder = doc.createElement("button");
    placeholder.type = "button";
    placeholder.className = "cm-fea-fold-placeholder";
    placeholder.textContent = "…";
    placeholder.setAttribute("aria-label", "Show rules");
    placeholder.addEventListener("click", unfold);
    row.append(placeholder);
    appendHighlightedLine(row, ` ${lines.at(-1) ?? ""}`);
    return row;
  }

  #lines(doc: Document, lines: readonly string[]): HTMLElement[] {
    return lines.map((line) => {
      const row = doc.createElement("div");
      appendHighlightedLine(row, line);
      return row;
    });
  }

  #lensAction(doc: Document, label: string, run: () => void): HTMLButtonElement {
    const action = doc.createElement("button");
    action.type = "button";
    action.className = "cm-fea-lens-action";
    action.textContent = label;
    action.addEventListener("click", run);
    return action;
  }
}

/** What makes two problem lists show the same, for redrawing only when they differ. */
function problemKey(problems: readonly FeatureDiagnostic[]): string {
  return problems
    .map((problem) => `${problem.generatedTag}:${problem.from}:${problem.message}`)
    .join("|");
}

function separator(doc: Document): HTMLElement {
  const dot = doc.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.textContent = "·";
  return dot;
}

const setGenerated = StateEffect.define<DecorationSet>();

const generatedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(blocks, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setGenerated)) continue;
      // A CodeMirror state effect's payload, not a reactive signal.
      const { value: replacement } = effect;
      return replacement;
    }
    return blocks.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The extension that shows generated features after the code. */
export const generatedFeatureBlocks = generatedField;

/** Shows `features` after the code in `view`; an empty list shows none. */
export function showGeneratedFeatures(
  view: EditorView,
  features: readonly GeneratedFeature[],
  problems: readonly FeatureDiagnostic[],
  actions: GeneratedFeatureActions,
): void {
  const end = view.state.doc.length;
  const blocks =
    features.length === 0
      ? Decoration.none
      : Decoration.set([
          Decoration.widget({
            widget: new GeneratedBlocks(features, problems, actions),
            block: true,
            side: 1,
          }).range(end),
        ]);
  view.dispatch({ effects: setGenerated.of(blocks) });
}

/** Scrolls the generated block for `tag` into view, if it is shown. */
export function revealGeneratedFeature(view: EditorView, tag: string): void {
  const block = view.dom.querySelector(`[data-generated-tag="${CSS.escape(tag)}"]`);
  block?.scrollIntoView({ block: "start", behavior: "smooth" });
}
