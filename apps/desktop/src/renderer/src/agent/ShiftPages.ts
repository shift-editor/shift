import {
  LastPageError,
  PageNotFoundError,
  type PageChange,
  type PageCreateInput,
  type PageDeleteInput,
  type PageRenameInput,
  type ShiftReadInput,
} from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { PageNode } from "@shift/editor/types";
import type { NodeId } from "@shift/types";
import type { ShiftEditorReader } from "./ShiftEditorReader";

/**
 * Edits one window's pages as its pages list does: `Pages.create`, `rename`
 * and `delete`, one undo step each.
 *
 * @remarks
 * Only the user's pages are edited; a glyph tab's page is not in the list, so
 * its id is a {@link PageNotFoundError}. Every method checks its input first
 * and changes nothing when it throws, and answers with the page it touched
 * and the pages as `editor.inspect` lists them.
 */
export class ShiftPages {
  readonly #editor: Editor;
  readonly #reader: ShiftEditorReader;

  constructor(editor: Editor, reader: ShiftEditorReader) {
    this.#editor = editor;
    this.#reader = reader;
  }

  /** Adds an empty page after the last one; the shown page stays shown. */
  create({ name }: ShiftReadInput<PageCreateInput>): PageChange {
    return this.#change(this.#editor.pages.create(name));
  }

  /**
   * Renames a page; its own name changes nothing and records no undo step.
   *
   * @throws {PageNotFoundError} when no page in the list has that id.
   */
  rename({ pageId, name }: ShiftReadInput<PageRenameInput>): PageChange {
    this.#page(pageId);
    this.#editor.pages.rename(pageId, name);
    return this.#change(this.#page(pageId));
  }

  /**
   * Deletes a page and everything on it; deleting the shown page shows its
   * neighbour first.
   *
   * @throws {PageNotFoundError} when no page in the list has that id.
   * @throws {LastPageError} when it is the document's only page.
   */
  delete({ pageId }: ShiftReadInput<PageDeleteInput>): PageChange {
    const page = this.#page(pageId);
    const pages = this.#editor.pages;
    if (pages.list.length <= 1) throw new LastPageError(pageId);
    if (!pages.delete(pageId)) throw new Error(`Page ${pageId} could not be deleted`);

    return this.#change(page);
  }

  /** @throws {PageNotFoundError} when no page in the list has `pageId`. */
  #page(pageId: NodeId): PageNode {
    const page = this.#editor.pages.page(pageId);
    if (!page) throw new PageNotFoundError(pageId);
    return page;
  }

  #change({ id, name }: PageNode): PageChange {
    return { page: { id, name }, pages: this.#reader.pages() };
  }
}
