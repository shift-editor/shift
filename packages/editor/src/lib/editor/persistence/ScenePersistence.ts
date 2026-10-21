import { batch } from "../../signals";
import type { ShiftStore } from "../../store/ShiftStore";
import { isSessionRecord } from "../../store/recordScope";
import type { Editor } from "../Editor";
import type { NodeId } from "@shift/types";
import type { ShiftEditorRecord, ShiftNodeRecord } from "../../../types/records";
import type {
  PersistedSceneRecord,
  ScenePersistenceOptions,
  SceneRestore,
  SceneStateStore,
  StoredSceneState,
} from "../../../types/sceneState";
import type { StoreChange } from "../../../types/store";
import { decodeSceneState, encodeSceneState } from "./scenePayload";

const DEFAULT_DELAY_MS = 500;

/**
 * Keeps the editor's document-scoped canvas records with the document.
 *
 * @remarks
 * Mirrors `ShiftStore.onChange`: any change to a text run or a scene node
 * schedules one write of the whole canvas after `delayMs` of quiet, so a
 * burst of typing or a drag becomes one write. Selection, editing, the text
 * caret, hover, and the camera are session state and never written.
 * {@link flush} writes a pending change at once; callers flush before a
 * save, on blur, and before the window closes. Undo stays with
 * `EditorHistory`: replayed records are ordinary store changes, so they are
 * written like any other.
 */
export class ScenePersistence {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly #sceneStore: SceneStateStore;
  readonly #delayMs: number;
  readonly #unsubscribe: () => void;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The payload last written or restored, or the canvas the store started
   * with, so an untouched empty canvas never writes; null forces a write.
   */
  #written: string | null;
  #lastWrite: Promise<void> = Promise.resolve();

  constructor(
    store: ShiftStore<ShiftEditorRecord>,
    editor: Editor,
    options: ScenePersistenceOptions,
  ) {
    this.#store = store;
    this.#editor = editor;
    this.#sceneStore = options.store;
    this.#delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.#written = encodeSceneState(this.#records()).payload;
    this.#unsubscribe = store.onChange((change) => {
      if (isPersistedChange(change)) this.#schedule();
    });
  }

  /**
   * Puts the stored canvas back into the editor.
   *
   * @remarks
   * Restoring is not an edit: it records no history and writes nothing back.
   * Records whose references no longer resolve are left out and logged. When
   * the canvas has a child glyph, its source becomes the active source, so
   * the editor shows the layer that was being edited.
   *
   * @returns the records put back and the records left out.
   * @throws {Error} when the store cannot be read.
   */
  async restore(): Promise<SceneRestore> {
    const stored = await this.#sceneStore.read();
    if (!stored) return { restored: [], dropped: [] };

    const font = this.#editor.font;
    const restore = decodeSceneState(stored, {
      hasGlyph: (glyphId) => font.recordForId(glyphId) !== null,
      hasSource: (sourceId) => font.source(sourceId) !== null,
    });
    if (restore.dropped.length > 0) {
      console.warn("scene restore dropped stale records", restore.dropped);
    }

    this.#editor.history.withoutRecording(() =>
      batch(() => {
        for (const record of restore.restored) this.#store.put(record);
      }),
    );
    this.#cancelTimer();
    this.#written = encodeSceneState(this.#records()).payload;

    const child = restore.restored.find(
      (record) => record.type === "node" && record.kind === "glyph" && record.parentId !== null,
    );
    if (child?.type === "node" && child.kind === "glyph") this.#editor.selectSource(child.sourceId);

    return restore;
  }

  /**
   * Writes a pending canvas change now.
   *
   * @remarks
   * The write is issued synchronously, so a save the caller issues afterwards
   * on the same ordered store lands behind it. A failed write is logged and
   * retried on the next flush; it never rejects, so a canvas failure cannot
   * block saving the font.
   *
   * @returns a promise that settles when the latest write has landed.
   */
  flush(): Promise<void> {
    this.#cancelTimer();

    const state = encodeSceneState(this.#records());
    if (state.payload === this.#written) return this.#lastWrite;

    this.#written = state.payload;
    this.#lastWrite = this.#write(state);
    return this.#lastWrite;
  }

  /** Stops following the store and drops any unwritten change. */
  dispose(): void {
    this.#cancelTimer();
    this.#unsubscribe();
  }

  #schedule(): void {
    this.#cancelTimer();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.#delayMs);
  }

  #cancelTimer(): void {
    if (this.#timer === null) return;

    clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #write(state: StoredSceneState): Promise<void> {
    try {
      await this.#sceneStore.write(state);
    } catch (error) {
      if (this.#written === state.payload) this.#written = null;
      console.error("failed to store the scene", error);
    }
  }

  /**
   * Every document-scoped canvas record, read from the store rather than a
   * scene view, in restore order: runs, then nodes with parents first.
   */
  #records(): PersistedSceneRecord[] {
    const records = this.#store.records().filter(isPersistedRecord);
    const nodes = new Map<NodeId, ShiftNodeRecord>();
    for (const record of records) if (record.type === "node") nodes.set(record.id, record);

    const ordered: PersistedSceneRecord[] = records.filter((record) => record.type === "textrun");
    const placed = new Set<NodeId>();
    const place = (node: ShiftNodeRecord): void => {
      if (placed.has(node.id)) return;
      placed.add(node.id);
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) place(parent);
      ordered.push(node);
    };
    for (const node of nodes.values()) place(node);
    return ordered;
  }
}

/**
 * Whether a record is canvas content kept with the document: every text run
 * and every scene node of any kind, unless it declares `scope: "session"`
 * (see {@link isSessionRecord}).
 */
function isPersistedRecord(record: ShiftEditorRecord): record is PersistedSceneRecord {
  if (isSessionRecord(record)) return false;

  return record.type === "textrun" || record.type === "node";
}

function isPersistedChange(change: StoreChange<ShiftEditorRecord>): boolean {
  const record = change.after ?? change.before;
  return record !== null && isPersistedRecord(record);
}
