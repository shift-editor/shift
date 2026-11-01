import { z } from "zod";
import {
  asGlyphId,
  asNodeId,
  RecentList,
  type RecentListRules,
  type WorkspaceDocumentState,
} from "@shift/types";
import { parseEach } from "@shared/parseEach";

const glyphIdSchema = z.string().startsWith("glyph_").transform(asGlyphId);
const nodeIdSchema = z.string().startsWith("node_").transform(asNodeId);

const storedTabSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), pageId: nodeIdSchema }).strict(),
  z.object({ kind: z.literal("glyph"), pageId: nodeIdSchema, glyphId: glyphIdSchema }).strict(),
]);

const storedCameraSchema = z
  .object({
    pan: z.object({ x: z.number(), y: z.number() }).strict(),
    zoom: z.number().positive(),
  })
  .strict();

const documentViewSchema = z
  .object({
    /** The glyph the editor route shows; absent on Home and the canvas. */
    glyphId: glyphIdSchema.optional(),
    /** Present when the window showed a page's canvas. */
    canvas: z.literal(true).optional(),
    /** The page the canvas showed. */
    pageId: nodeIdSchema.optional(),
    /** The window's page and glyph tabs in order, after the pinned Glyphs tab. */
    tabs: z.array(storedTabSchema).optional(),
    /** The page the font overview shows its selected glyph on. */
    selectionPageId: nodeIdSchema.optional(),
    /** Each page's pan and zoom as last left, by page id. */
    cameras: z.record(nodeIdSchema, storedCameraSchema).optional(),
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

/** One page's camera as a {@link DocumentView} keeps it. */
export type StoredCamera = z.output<typeof storedCameraSchema>;

/** One page or glyph tab as a {@link DocumentView} keeps it. */
export type StoredTab = z.output<typeof storedTabSchema>;

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

  /**
   * Records part of the view for `key`, keeping the rest of what was remembered.
   *
   * @param patch - The fields to replace; a field set to `undefined` is forgotten.
   */
  update(key: string, patch: DocumentView, usedAt: number = Date.now()): void {
    this.write(key, { ...this.read(key), ...patch }, usedAt);
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
