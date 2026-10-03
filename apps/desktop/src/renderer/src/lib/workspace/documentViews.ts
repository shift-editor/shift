import { z } from "zod";
import { asGlyphId, type WorkspaceDocumentState } from "@shift/types";

const documentViewSchema = z
  .object({
    glyphId: z.string().startsWith("glyph_").transform(asGlyphId).optional(),
  })
  .strict();

const storedViewSchema = documentViewSchema
  .extend({
    key: z.string().min(1),
    usedAt: z.number().int().nonnegative(),
  })
  .strict();

/** What a viewer last saw in one document, restored when the document resumes. */
export type DocumentView = z.output<typeof documentViewSchema>;

type StoredView = z.output<typeof storedViewSchema>;

type ViewStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "shift.documentViews";

/** Most documents remembered; the least recently used fall off. */
export const DOCUMENT_VIEWS_LIMIT = 50;

/**
 * Identifies a document across sessions: by `DocumentId` once it has one, so moves
 * and renames keep its view, otherwise by its untitled workspace.
 */
export function documentViewKey(state: WorkspaceDocumentState): string {
  return state.documentId ?? `workspace:${state.workspaceId}`;
}

/**
 * Per-viewer document views kept in renderer storage.
 *
 * @remarks
 * View state is personal, so it never goes into the document. Storage can be missing or
 * throw; reads then find nothing and writes are dropped.
 */
export class DocumentViews {
  readonly #storage: () => ViewStorage;

  constructor(storage: () => ViewStorage = () => localStorage) {
    this.#storage = storage;
  }

  /** Returns the view last recorded for `key`, or null when none is remembered. */
  read(key: string): DocumentView | null {
    const stored = this.#readAll().find((view) => view.key === key);
    if (!stored) return null;

    const { key: _key, usedAt: _usedAt, ...view } = stored;
    return view;
  }

  /** Records the view for `key`, replacing what was remembered. */
  write(key: string, view: DocumentView, usedAt: number = Date.now()): void {
    const others = this.#readAll().filter((stored) => stored.key !== key);
    const views = [{ ...view, key, usedAt }, ...others]
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, DOCUMENT_VIEWS_LIMIT);

    try {
      this.#storage().setItem(STORAGE_KEY, JSON.stringify(views));
    } catch (error) {
      console.warn("failed to remember document view", error);
    }
  }

  #readAll(): StoredView[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.#storage().getItem(STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    // Drop entries individually so one malformed view cannot forget every document.
    return parsed.flatMap((value) => {
      const result = storedViewSchema.safeParse(value);
      return result.success ? [result.data] : [];
    });
  }
}
