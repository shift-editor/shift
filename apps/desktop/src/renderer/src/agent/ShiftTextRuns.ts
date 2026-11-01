import {
  PageNotFoundError,
  ProofTextError,
  TextCaretError,
  TextRunOptionsError,
  TextRunNotFoundError,
  UnknownGlyphNameError,
  type PagePoint,
  type ShiftReadInput,
  type TextRunCreateInput,
  type TextRunDeleteInput,
  type TextRunGetInput,
  type TextRunSetCaretInput,
  type TextRunSetOptionsInput,
  type TextRunSetTextInput,
  type TextRunsInput,
  type TextRunSummary,
  type TextRunView,
} from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { ParsedText, TextItem } from "@shift/editor/text";
import type { PageNode, TextRunNode } from "@shift/editor/types";
import type { NodeId } from "@shift/types";
import type { ShiftEditorReader } from "./ShiftEditorReader";

/**
 * The canvas text runs (proof text) of one editor, as agents read and write
 * them: runtime DTOs in, runtime DTOs out.
 *
 * @remarks
 * Writes go through the Text tool's own path (`Text` and `TextEditing`), so
 * each is one undo step and marks the document unsaved as typing does; a
 * caret placement is session state. None changes the font. Revision guarding
 * and transport belong to the caller.
 */
export class ShiftTextRuns {
  readonly #editor: Editor;
  readonly #reader: ShiftEditorReader;

  constructor(editor: Editor, reader: ShiftEditorReader) {
    this.#editor = editor;
    this.#reader = reader;
  }

  /**
   * The runs on a page, in the page's order.
   *
   * @throws {PageNotFoundError} for an unknown page, or no page shown.
   */
  runs({ pageId }: ShiftReadInput<TextRunsInput> = {}): TextRunSummary[] {
    const page = this.#page(pageId);
    return this.#editor.scene
      .childrenOfKind(page.id, "textRun")
      .map((node) => this.#summary(node, page));
  }

  /**
   * One run as it shows now, once the glyphs it shows have loaded.
   *
   * @throws {TextRunNotFoundError} for an unknown run.
   */
  async get({ runId }: ShiftReadInput<TextRunGetInput>): Promise<TextRunView> {
    this.#run(runId);
    await this.#editor.text.settled();
    return this.#view(runId);
  }

  /**
   * Places a new run as one undo step.
   *
   * @throws {PageNotFoundError} for an unknown page, or no page shown.
   * @throws {UnknownGlyphNameError} when the text picks a glyph the font lacks; nothing is placed.
   */
  async create({ pageId, text, at }: ShiftReadInput<TextRunCreateInput>): Promise<TextRunView> {
    const page = this.#page(pageId);
    const items = this.#items(text);
    const node = this.#editor.text.addRun({ page, at: at ?? this.#nextRunOrigin(page), items });
    return this.get({ runId: node.id });
  }

  /**
   * Replaces a run's text as one undo step.
   *
   * @throws {TextRunNotFoundError} for an unknown run.
   * @throws {UnknownGlyphNameError} as {@link create}; the run keeps its text.
   */
  async setText({ runId, text }: ShiftReadInput<TextRunSetTextInput>): Promise<TextRunView> {
    const node = this.#run(runId);
    const items = this.#items(text);
    this.#editor.history.capture("Set text", () => this.#editor.text.setItems(node.runId, items));
    return this.get({ runId });
  }

  /**
   * Shows the Text mode caret in a run, with a selection when one is given.
   *
   * @remarks
   * Shows the run's page and switches to the Text tool first when they are
   * not already, as a user would before clicking into the run. Never an undo
   * step or an unsaved change.
   *
   * @throws {TextRunNotFoundError} for an unknown run.
   * @throws {TextCaretError} for a position or selection past the run's end.
   */
  async setCaret({
    runId,
    position,
    selection,
  }: ShiftReadInput<TextRunSetCaretInput>): Promise<TextRunView> {
    const node = this.#run(runId);
    const anchor = caretAnchor(runId, this.#editor.text.items(node).length, position, selection);
    const page = this.#editor.scene.pageOf(node.id);
    if (page) this.#editor.pages.activate(page.id);
    this.#editor.setActiveTool("text");
    this.#editor.textEditing.placeIn(node.id, position, anchor);
    return this.get({ runId });
  }

  /**
   * Removes a run as one undo step.
   *
   * @throws {TextRunNotFoundError} for an unknown run.
   */
  delete({ runId }: ShiftReadInput<TextRunDeleteInput>): null {
    const node = this.#run(runId);
    this.#editor.history.capture("Delete text", () => this.#editor.scene.deleteNode(node.id));
    return null;
  }

  /**
   * Changes some of a run's options in one undo step, as the Text section
   * does: `Text.setSettings`, which Rust checks.
   *
   * @throws {TextRunNotFoundError} for an unknown run.
   * @throws {TextRunOptionsError} for an option Rust refuses; the run is unchanged.
   */
  async setOptions({
    runId,
    options,
  }: ShiftReadInput<TextRunSetOptionsInput>): Promise<TextRunView> {
    const node = this.#run(runId);
    this.#editor.history.capture("Set text options", () => {
      try {
        this.#editor.text.setSettings(node.runId, options);
      } catch (error) {
        // The run exists, so the engine refused the settings themselves.
        throw new TextRunOptionsError(error instanceof Error ? error.message : String(error));
      }
    });
    return this.get({ runId });
  }

  #summary(node: TextRunNode, page: PageNode): TextRunSummary {
    const run = this.#editor.text.run(node.runId);
    if (!run) throw new TextRunNotFoundError(node.id);

    return {
      id: node.id,
      pageId: page.id,
      text: this.#editor.text.formatItems(run.items),
      at: { x: node.position.x, y: node.position.y },
      options: this.#reader.textRunOptions(run),
    };
  }

  #view(runId: NodeId): TextRunView {
    const view = this.#reader.textRun(runId);
    if (!view) throw new TextRunNotFoundError(runId);
    return view;
  }

  /**
   * @throws {ProofTextError} when the text is not proof text.
   * @throws {UnknownGlyphNameError} when the text picks a glyph the font lacks.
   */
  #items(text: string): TextItem[] {
    const { items, unknownGlyphNames } = this.#parse(text);
    if (unknownGlyphNames.length > 0) throw new UnknownGlyphNameError(unknownGlyphNames);
    return items;
  }

  /** @throws {ProofTextError} when the text is not proof text, as Rust's parser says (`PackError`). */
  #parse(text: string): ParsedText {
    try {
      return this.#editor.text.parseText(text);
    } catch (error) {
      if (error instanceof Error && error.name === "PackError") {
        throw new ProofTextError(error.message);
      }
      throw error;
    }
  }

  /**
   * Where a new run goes on `page` when no position is given: one line below
   * the page's last run, or where the Text tool places a run on an empty page.
   */
  #nextRunOrigin(page: PageNode): PagePoint {
    const editor = this.#editor;
    const last = editor.scene.childrenOfKind(page.id, "textRun").at(-1);
    if (!last) return editor.camera.textInsertionPoint() ?? { x: 0, y: 0 };

    // Scene y runs down; a run's lines go down from its origin, one line height apart.
    const layout = editor.text.layout(last.runId);
    const below = layout ? layout.lines.length * layout.lineHeight : 0;
    const scale = editor.nodeDefinition("textRun").emScale(last);
    return { x: last.position.x, y: last.position.y + below * scale };
  }

  #page(pageId: NodeId | undefined): PageNode {
    const scene = this.#editor.scene;
    const page = pageId === undefined ? scene.shownPage() : scene.nodeOfKind(pageId, "page");
    if (!page) throw new PageNotFoundError(pageId ?? null);
    return page;
  }

  #run(runId: NodeId): TextRunNode {
    const node = this.#editor.scene.nodeOfKind(runId, "textRun");
    if (!node) throw new TextRunNotFoundError(runId);
    return node;
  }
}

/**
 * The selection anchor for a caret at `position`: the selection's other end,
 * or `position` itself for a collapsed caret.
 *
 * @throws {TextCaretError} for a position or selection outside a run of
 * `length` items, or a position at neither end of the selection.
 */
function caretAnchor(
  runId: NodeId,
  length: number,
  position: number,
  selection: TextRunSetCaretInput["selection"],
): number {
  const { start, end } = selection ?? { start: position, end: position };
  if (end > length) {
    throw new TextCaretError(
      `Run ${runId} has ${length} items, so positions run from 0 to ${length}`,
    );
  }
  if (start > end || (position !== start && position !== end)) {
    throw new TextCaretError(
      `The caret must sit at one end of the selection: start ${start} <= end ${end}, position ${position}`,
    );
  }

  return position === start ? end : start;
}
