import type { Editor } from "@/lib/editor/Editor";
import { effect, type Effect } from "@/lib/reactive/signal";
import { PersistedRootSchema } from "@shift/validation";
import type { PersistenceModule } from "./module";
import { textRunModule } from "./modules/textRun";
import { toolStateAppModule, toolStateDocumentModule } from "./modules/toolState";
import { userPreferencesModule } from "./modules/userPreferences";
import {
  PERSISTENCE_DOCUMENT_LIMIT,
  PERSISTENCE_SCHEMA_VERSION,
  type PersistedDocumentState,
  type PersistedModuleEnvelope,
  type PersistedRoot,
} from "./types";

const STORAGE_KEY = "shift:persisted-state";
const SAVE_DEBOUNCE_MS = 300;

function createEmptyState(): PersistedRoot {
  return {
    version: PERSISTENCE_SCHEMA_VERSION,
    registry: {
      nextDocId: 1,
      pathToDocId: {},
      docIdToPath: {},
      lruDocIds: [],
    },
    appModules: {},
    documents: {},
  };
}

function normalizeState(raw: unknown): PersistedRoot {
  const parsed = PersistedRootSchema.safeParse(raw);
  if (!parsed.success) return createEmptyState();
  if (parsed.data.version !== PERSISTENCE_SCHEMA_VERSION) return createEmptyState();
  return parsed.data as PersistedRoot;
}

function toDocId(numericId: number): string {
  return `doc-${numericId}`;
}

export class DocumentStatePersistence {
  #editor: Editor | null = null;
  #state: PersistedRoot = createEmptyState();
  #appModules = new Map<string, PersistenceModule>();
  #documentModules = new Map<string, PersistenceModule>();
  #effects: Effect[] = [];
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #currentDocId: string | null = null;
  #currentPath: string | null = null;
  #isHydrating = false;

  constructor(extraModules: PersistenceModule[] = []) {
    this.registerModule(userPreferencesModule);
    this.registerModule(textRunModule);
    this.registerModule(toolStateAppModule);
    this.registerModule(toolStateDocumentModule);
    for (const module of extraModules) {
      this.registerModule(module);
    }
  }

  init(editor: Editor): void {
    if (this.#editor === editor) return;
    this.disposeWatchers();
    this.#editor = editor;
    this.#state = this.readState();
    this.hydrateAppModules();
    this.installWatchers(editor);
  }

  registerModule(module: PersistenceModule): void {
    const target = module.scope === "app" ? this.#appModules : this.#documentModules;
    if (target.has(module.id)) {
      throw new Error(`Persistence module "${module.id}" already registered`);
    }
    target.set(module.id, module);
  }

  getState(): PersistedRoot {
    return this.#editor ? this.#state : this.readState();
  }

  openDocument(filePath: string): void {
    if (!this.#editor) return;
    this.flushNow();

    const normalizedPath = this.normalizePath(filePath);
    const docId = this.resolveDocId(normalizedPath);
    this.#currentDocId = docId;
    this.#currentPath = normalizedPath;
    this.touchLru(docId);

    this.hydrateDocumentModules(docId);
    this.scheduleSave();
  }

  closeDocument(): void {
    this.flushNow();
    this.#currentDocId = null;
    this.#currentPath = null;
  }

  onDocumentPathChanged(filePath: string | null): void {
    if (!filePath) {
      this.#currentPath = null;
      return;
    }

    const normalizedPath = this.normalizePath(filePath);
    if (!this.#currentDocId) {
      this.#currentDocId = this.resolveDocId(normalizedPath);
      this.#currentPath = normalizedPath;
      this.touchLru(this.#currentDocId);
      this.scheduleSave();
      return;
    }

    if (
      this.#currentPath &&
      this.#state.registry.pathToDocId[this.#currentPath] === this.#currentDocId
    ) {
      delete this.#state.registry.pathToDocId[this.#currentPath];
    }

    this.#state.registry.pathToDocId[normalizedPath] = this.#currentDocId;
    this.#state.registry.docIdToPath[this.#currentDocId] = normalizedPath;
    this.#currentPath = normalizedPath;
    this.touchLru(this.#currentDocId);
    this.scheduleSave();
  }

  flushNow(): void {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    this.flush();
  }

  async prunePaths(paths: Set<string>): Promise<void> {
    const state = this.getState();
    for (const p of paths) {
      const docId = state.registry.pathToDocId[p];
      if (!docId) continue;
      state.registry.lruDocIds = state.registry.lruDocIds.filter((id) => id !== docId);
      delete state.registry.docIdToPath[docId];
      delete state.documents[docId];
      delete state.registry.pathToDocId[p];
    }
    this.writeState(state);
  }

  async getRecentDocuments(): Promise<{ name: string; path: string }[]> {
    const state = this.getState();

    const paths = new Set(
      state.registry.lruDocIds.slice(0, 10).map((docId) => state.registry.docIdToPath[docId]),
    );

    if (paths.size === 0) return [];

    const documents = Array.from(paths).map((p) => ({
      name:
        p
          .split("/")
          .pop()
          ?.replace(/\.(otf|ttf|ufo|glyphs|woff2?)$/i, "") ?? p,
      path: p,
    }));

    return documents;
  }

  dispose(): void {
    this.flushNow();
    this.disposeWatchers();
    this.#editor = null;
  }

  private installWatchers(editor: Editor): void {
    this.#effects.push(
      effect(() => {
        editor.getTextRunState();
        this.scheduleSave();
      }),
    );

    let lastGlyphUnicode: number | null = null;
    this.#effects.push(
      effect(() => {
        const glyph = editor.glyph.value;
        const unicode = glyph?.unicode ?? null;
        if (unicode === lastGlyphUnicode) return;
        lastGlyphUnicode = unicode;
        this.scheduleSave();
      }),
    );

    this.#effects.push(
      effect(() => {
        editor.snapPreferences.value;
        this.scheduleSave();
      }),
    );

    this.#effects.push(
      effect(() => {
        editor.toolStateVersion.value;
        this.scheduleSave();
      }),
    );
  }

  private disposeWatchers(): void {
    for (const fx of this.#effects) {
      fx.dispose();
    }
    this.#effects = [];
  }

  private hydrateAppModules(): void {
    if (!this.#editor) return;
    this.#isHydrating = true;
    try {
      for (const module of this.#appModules.values()) {
        const envelope = this.#state.appModules[module.id];
        this.hydrateModule(module, envelope);
      }
    } finally {
      this.#isHydrating = false;
    }
  }

  private hydrateDocumentModules(docId: string): void {
    if (!this.#editor) return;
    const documentState = this.ensureDocumentState(docId);
    this.#isHydrating = true;
    try {
      for (const module of this.#documentModules.values()) {
        const envelope = documentState.modules[module.id];
        this.hydrateModule(module, envelope);
      }
    } finally {
      this.#isHydrating = false;
    }
  }

  private hydrateModule(module: PersistenceModule, envelope?: PersistedModuleEnvelope): void {
    if (!this.#editor) return;
    if (!envelope) {
      module.clear?.({ editor: this.#editor });
      return;
    }

    let payload: unknown = envelope.payload;
    if (envelope.moduleVersion !== module.version) {
      if (!module.migrate) return;
      payload = module.migrate(payload, envelope.moduleVersion, module.version);
    }

    if (!module.validate(payload)) return;
    module.hydrate({ editor: this.#editor }, payload);
  }

  private captureAppModules(): void {
    if (!this.#editor) return;
    for (const module of this.#appModules.values()) {
      const payload = module.capture({ editor: this.#editor });
      if (payload == null) {
        delete this.#state.appModules[module.id];
        continue;
      }
      this.#state.appModules[module.id] = {
        moduleVersion: module.version,
        payload,
      };
    }
  }

  private captureCurrentDocumentModules(): void {
    if (!this.#editor || !this.#currentDocId) return;
    const documentState = this.ensureDocumentState(this.#currentDocId);
    documentState.updatedAt = Date.now();

    for (const module of this.#documentModules.values()) {
      const payload = module.capture({ editor: this.#editor });
      if (payload == null) {
        delete documentState.modules[module.id];
        continue;
      }
      documentState.modules[module.id] = {
        moduleVersion: module.version,
        payload,
      };
    }
  }

  private flush(): void {
    if (!this.#editor) return;
    this.captureAppModules();
    this.captureCurrentDocumentModules();
    this.pruneDocuments();
    this.writeState(this.#state);
  }

  private scheduleSave(): void {
    if (this.#isHydrating || !this.#editor) return;
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
    }
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  private ensureDocumentState(docId: string): PersistedDocumentState {
    const existing = this.#state.documents[docId];
    if (existing) return existing;

    const next: PersistedDocumentState = {
      docId,
      updatedAt: Date.now(),
      modules: {},
    };
    this.#state.documents[docId] = next;
    return next;
  }

  private resolveDocId(normalizedPath: string): string {
    const fromPath = this.#state.registry.pathToDocId[normalizedPath];
    if (fromPath) {
      this.#state.registry.docIdToPath[fromPath] = normalizedPath;
      return fromPath;
    }

    const nextId = toDocId(this.#state.registry.nextDocId);
    this.#state.registry.nextDocId += 1;
    this.#state.registry.pathToDocId[normalizedPath] = nextId;
    this.#state.registry.docIdToPath[nextId] = normalizedPath;
    return nextId;
  }

  private touchLru(docId: string): void {
    const lru = this.#state.registry.lruDocIds;
    const existingIdx = lru.indexOf(docId);
    if (existingIdx >= 0) {
      lru.splice(existingIdx, 1);
    }
    lru.unshift(docId);
  }

  private pruneDocuments(): void {
    const lru = this.#state.registry.lruDocIds;
    while (lru.length > PERSISTENCE_DOCUMENT_LIMIT) {
      const removedDocId = lru.pop();
      if (!removedDocId) break;
      if (removedDocId === this.#currentDocId) continue;

      delete this.#state.documents[removedDocId];
      delete this.#state.registry.docIdToPath[removedDocId];

      for (const [path, docId] of Object.entries(this.#state.registry.pathToDocId)) {
        if (docId === removedDocId) {
          delete this.#state.registry.pathToDocId[path];
        }
      }
    }
  }

  private readState(): PersistedRoot {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return createEmptyState();
      return normalizeState(JSON.parse(raw));
    } catch {
      return createEmptyState();
    }
  }

  private writeState(state: PersistedRoot): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore persistence errors (quota, unavailable storage).
    }
  }

  private normalizePath(filePath: string): string {
    const unixLike = filePath.replace(/\\/g, "/");
    if (/^[A-Z]:\//.test(unixLike)) {
      return `${unixLike[0].toLowerCase()}${unixLike.slice(1)}`;
    }
    return unixLike;
  }
}
