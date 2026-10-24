import { z } from "zod";
import {
  asGlyphId,
  RecentList,
  type RecentListRules,
  type WorkspaceDocumentState,
} from "@shift/types";
import { parseEach } from "@shared/parseEach";

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

/** One view per document key, most recently used first, at most {@link DOCUMENT_VIEWS_LIMIT}. */
const VIEW_RULES: RecentListRules<StoredView, string> = {
  matches: (stored, key) => stored.key === key,
  usedAt: (stored) => stored.usedAt,
  limit: DOCUMENT_VIEWS_LIMIT,
};

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
    const stored = this.#readAll().find(key);
    if (!stored) return null;

    const { key: _key, usedAt: _usedAt, ...view } = stored;
    return view;
  }

  /** Records the view for `key`, replacing what was remembered. */
  write(key: string, view: DocumentView, usedAt: number = Date.now()): void {
    const views = this.#readAll().touch(key, () => ({ ...view, key, usedAt }));

    try {
      this.#storage().setItem(STORAGE_KEY, JSON.stringify(views.items));
    } catch (error) {
      console.warn("failed to remember document view", error);
    }
  }

  #readAll(): RecentList<StoredView, string> {
    let text: string;
    try {
      text = this.#storage().getItem(STORAGE_KEY) ?? "[]";
    } catch {
      return RecentList.of([], VIEW_RULES);
    }

    // parseEach drops entries individually, so one malformed view cannot forget every document.
    return RecentList.of(parseEach(storedViewSchema, text), VIEW_RULES);
  }
}
