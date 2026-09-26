import { batch } from "../../signals";
import type { ShiftStore } from "../../store/ShiftStore";
import type { Editor } from "../Editor";
import type { PendingEditId } from "../../../types/editing";
import type { WorkspaceEditCoordinator } from "../../../types/font";
import type {
  HistoryCaptureContext,
  HistoryDirection,
  HistoryEffect,
  HistoryEntry,
  PendingHistoryEffect,
  RecordChange,
  RecordHistoryEffect,
  WorkspaceEditEvent,
  WorkspaceEffect,
} from "../../../types/history";
import type { ShiftEditorRecord } from "../../../types/records";
import { HistoryCapture } from "./HistoryCapture";
import { editorRecordsEqual, recordChanges } from "./recordChanges";

/**
 * Interleaves TypeScript editor records with ordered workspace undo entries.
 *
 * @remarks
 * Captures retain immutable store maps and publish only completed user actions.
 * Workspace replay remains owned by Rust; this class stores ordering markers,
 * never document snapshots or stable ledger identities.
 */
export class EditorHistory {
  readonly #editor: Editor;
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #workspace: WorkspaceEditCoordinator | null;
  readonly #unsubscribe: (() => void) | null;
  readonly #undoEntries: HistoryEntry[] = [];
  readonly #redoEntries: HistoryEntry[] = [];
  readonly #pending = new Map<PendingEditId, PendingHistoryEffect>();

  #capture: HistoryCaptureContext | null = null;
  #recordingDepth = 0;
  #discardingRedo: Promise<void> | null = null;
  #disposed = false;

  /**
   * Creates workspace-lifetime history over one editor record store.
   *
   * @param editor - Owner used to validate session records during replay.
   * @param store - TypeScript-owned records captured and restored by value.
   * @param workspace - Ordered document replay authority.
   */
  constructor(
    editor: Editor,
    store: ShiftStore<ShiftEditorRecord>,
    workspace: WorkspaceEditCoordinator | null,
  ) {
    this.#editor = editor;
    this.#store = store;
    this.#workspace = workspace;
    this.#unsubscribe = workspace?.onEdit((event) => this.#workspaceChanged(event)) ?? null;
  }

  get capturing(): boolean {
    return this.#capture !== null;
  }

  /**
   * Begins one explicit user action from the current editor-record map.
   *
   * @param label - Human-readable action name retained with the history entry.
   * @returns a synchronous terminal handle for the action.
   * @throws {Error} when another capture is already open.
   */
  begin(label: string): HistoryCapture {
    if (this.#capture) throw new Error("editor history already has an open capture");

    const capture = new HistoryCapture(
      () => this.#finishCapture(capture),
      () => this.#cancelCapture(capture),
    );
    this.#capture = {
      capture,
      label,
      before: this.#store.cell.peek(),
      editIds: [],
    };
    return capture;
  }

  /** Reverses the latest editor action after all pending workspace edits settle. */
  async undo(): Promise<boolean> {
    this.#assertNoCapture("undo");
    await this.#settled();

    const entry = this.#undoEntries.pop();
    if (!entry) return this.#undoWorkspaceOnly();

    let workspaceReplayed = false;
    try {
      if (!(await this.#replayWorkspace(entry, "undo"))) {
        this.#undoEntries.push(entry);
        return false;
      }

      workspaceReplayed = hasWorkspaceEffect(entry);
      this.#applyEntryRecords(entry, true);
      this.#redoEntries.push(entry);
      return true;
    } catch (error) {
      if (workspaceReplayed) await this.#replayWorkspace(entry, "redo");
      this.#undoEntries.push(entry);
      throw error;
    }
  }

  /** Reapplies the latest editor action after all pending workspace edits settle. */
  async redo(): Promise<boolean> {
    this.#assertNoCapture("redo");
    await this.#settled();

    const entry = this.#redoEntries.pop();
    if (!entry) return this.#redoWorkspaceOnly();

    let workspaceReplayed = false;
    try {
      if (!(await this.#replayWorkspace(entry, "redo"))) {
        this.#redoEntries.push(entry);
        return false;
      }

      workspaceReplayed = hasWorkspaceEffect(entry);
      this.#applyEntryRecords(entry, false);
      this.#undoEntries.push(entry);
      return true;
    } catch (error) {
      if (workspaceReplayed) await this.#replayWorkspace(entry, "undo");
      this.#redoEntries.push(entry);
      throw error;
    }
  }

  /**
   * Runs setup or hydration work without attaching accepted workspace edits.
   *
   * @param body - Synchronous work outside the retained user-action timeline.
   * @returns the body's result.
   */
  withoutRecording<T>(body: () => T): T {
    this.#recordingDepth += 1;
    try {
      return body();
    } finally {
      this.#recordingDepth -= 1;
    }
  }

  /** Permanently removes workspace subscriptions and pending session history. */
  dispose(): void {
    if (this.#disposed) return;

    if (this.#capture) this.#capture.capture.cancel();
    this.#disposed = true;
    if (this.#unsubscribe) this.#unsubscribe();
    this.#capture = null;
    this.#pending.clear();
    this.#undoEntries.length = 0;
    this.#redoEntries.length = 0;
  }

  #finishCapture(capture: HistoryCapture): void {
    const context = this.#capture;
    if (context?.capture !== capture) return;

    const changes = recordChanges(context.before, this.#store.cell.peek());
    this.#capture = null;

    const editIds = context.editIds.filter((id) => this.#pending.get(id)?.outcome !== "failed");
    if (context.editIds.length > 0 && editIds.length === 0) {
      this.#applyRecordChanges(changes, true);
      this.#forgetFailed(context.editIds);
      return;
    }

    this.#forgetFailed(context.editIds);
    const workspaceEffects = editIds.flatMap((id) => {
      const pending = this.#pending.get(id);
      return pending ? [pending.effect] : [];
    });
    const effects = historyEffects(changes, workspaceEffects);
    if (effects.length === 0) return;

    const entry: HistoryEntry = { label: context.label, effects };
    const discardedWorkspaceRedo = this.#push(entry);
    for (const id of editIds) {
      const pending = this.#pending.get(id);
      if (!pending) continue;

      if (pending.outcome === "committed") {
        this.#pending.delete(id);
      } else {
        pending.entry = entry;
        pending.discardWorkspaceRedo = discardedWorkspaceRedo;
      }
    }
  }

  #cancelCapture(capture: HistoryCapture): void {
    const context = this.#capture;
    if (context?.capture !== capture) return;

    const changes = recordChanges(context.before, this.#store.cell.peek());
    this.#capture = null;
    this.#applyRecordChanges(changes, true);

    const survivingIds = context.editIds.filter(
      (id) => this.#pending.get(id)?.outcome !== "failed",
    );
    this.#forgetFailed(context.editIds);
    if (survivingIds.length === 0) return;

    const entry: HistoryEntry = {
      label: context.label,
      effects: survivingIds.flatMap((id) => {
        const pending = this.#pending.get(id);
        return pending ? [pending.effect] : [];
      }),
    };
    const discardedWorkspaceRedo = this.#push(entry);
    for (const id of survivingIds) {
      const pending = this.#pending.get(id);
      if (!pending) continue;

      if (pending.outcome === "committed") {
        this.#pending.delete(id);
      } else {
        pending.entry = entry;
        pending.discardWorkspaceRedo = discardedWorkspaceRedo;
      }
    }
  }

  #workspaceChanged(event: WorkspaceEditEvent): void {
    switch (event.kind) {
      case "accepted":
        this.#workspaceAccepted(event.id);
        return;
      case "committed":
        this.#workspaceCommitted(event.id);
        return;
      case "failed":
        this.#workspaceFailed(event.id);
    }
  }

  #workspaceAccepted(id: PendingEditId): void {
    if (this.#recordingDepth > 0 || this.#disposed) return;

    const pending: PendingHistoryEffect = {
      effect: { kind: "workspace" },
      entry: null,
      outcome: "pending",
      discardWorkspaceRedo: false,
    };
    this.#pending.set(id, pending);

    if (this.#capture) {
      this.#capture.editIds.push(id);
      return;
    }

    const entry: HistoryEntry = {
      label: "Edit font",
      effects: [pending.effect],
    };
    pending.entry = entry;
    pending.discardWorkspaceRedo = this.#push(entry);
  }

  #workspaceCommitted(id: PendingEditId): void {
    const pending = this.#pending.get(id);
    if (!pending) return;

    pending.outcome = "committed";
    if (!pending.entry) return;

    for (const candidate of this.#pending.values()) {
      if (candidate.entry === pending.entry) candidate.discardWorkspaceRedo = false;
    }
    this.#pending.delete(id);
  }

  #workspaceFailed(id: PendingEditId): void {
    const pending = this.#pending.get(id);
    if (!pending) return;

    pending.outcome = "failed";
    if (!pending.entry) return;

    const entry = pending.entry;
    const effects = entry.effects.filter((effect) => effect !== pending.effect);
    this.#pending.delete(id);

    if (effects.some((effect) => effect.kind === "workspace")) {
      this.#replaceEntry(entry, { ...entry, effects });
      return;
    }

    this.#removeFailedEntry(entry);
    if (pending.discardWorkspaceRedo) this.#startDiscardRedo();
  }

  #removeFailedEntry(entry: HistoryEntry): void {
    const index = this.#undoEntries.indexOf(entry);
    if (index < 0) return;

    this.#undoEntries.splice(index, 1);
    const records = recordEffect(entry);
    if (!records) return;

    batch(() => {
      for (const change of records.changes) {
        this.#rebaseLaterChange(index, change);
      }
    });
  }

  #rebaseLaterChange(start: number, failed: RecordChange): void {
    for (let index = start; index < this.#undoEntries.length; index++) {
      const entry = this.#undoEntries[index];
      const records = recordEffect(entry);
      if (!records) continue;

      const changeIndex = records.changes.findIndex((change) => change.id === failed.id);
      if (changeIndex < 0) continue;

      const change = records.changes[changeIndex];
      const changes = [...records.changes];
      if (editorRecordsEqual(failed.before, change.after)) {
        changes.splice(changeIndex, 1);
      } else {
        changes[changeIndex] = { ...change, before: failed.before };
      }

      const replacement = replaceRecordEffect(entry, changes);
      if (replacement) {
        this.#replaceEntry(entry, replacement);
        return;
      }

      this.#undoEntries.splice(index, 1);
      index -= 1;
    }

    this.#applyRecord(failed.id, failed.before);
  }

  #forgetFailed(ids: readonly PendingEditId[]): void {
    for (const id of ids) {
      if (this.#pending.get(id)?.outcome === "failed") this.#pending.delete(id);
    }
  }

  #push(entry: HistoryEntry): boolean {
    const discardedWorkspaceRedo = this.#redoEntries.some(hasWorkspaceEffect);
    this.#redoEntries.length = 0;
    this.#undoEntries.push(entry);

    if (discardedWorkspaceRedo && !hasWorkspaceEffect(entry)) this.#startDiscardRedo();
    return discardedWorkspaceRedo;
  }

  async #replayWorkspace(entry: HistoryEntry, direction: HistoryDirection): Promise<boolean> {
    const count = workspaceEffectCount(entry);
    if (count === 0) return true;
    if (!this.#workspace) return false;

    for (let replayed = 0; replayed < count; replayed++) {
      let applied: boolean;
      try {
        applied = await this.#replayWorkspaceEntry(direction);
      } catch (error) {
        await this.#restoreWorkspaceReplay(direction, replayed);
        throw error;
      }

      if (applied) continue;

      await this.#restoreWorkspaceReplay(direction, replayed);
      return false;
    }

    return true;
  }

  async #restoreWorkspaceReplay(direction: HistoryDirection, count: number): Promise<void> {
    const reverse = direction === "undo" ? "redo" : "undo";
    for (let index = 0; index < count; index++) {
      const applied = await this.#replayWorkspaceEntry(reverse);
      if (!applied) throw new Error("workspace history could not restore a partial replay");
    }
  }

  async #replayWorkspaceEntry(direction: HistoryDirection): Promise<boolean> {
    if (!this.#workspace) return false;

    const applied =
      direction === "undo" ? await this.#workspace.undo() : await this.#workspace.redo();
    return applied !== null;
  }

  #applyEntryRecords(entry: HistoryEntry, reverse: boolean): void {
    const records = recordEffect(entry);
    if (records) this.#applyRecordChanges(records.changes, reverse);
  }

  #applyRecordChanges(changes: readonly RecordChange[], reverse: boolean): void {
    batch(() => {
      for (const change of changes) {
        const record = reverse ? change.before : change.after;
        if (record?.type === "selection" || record?.type === "editing") continue;
        this.#applyRecord(change.id, record);
      }

      for (const change of changes) {
        const record = reverse ? change.before : change.after;
        if (record?.type !== "selection" && record?.type !== "editing") continue;
        this.#applyRecord(change.id, record);
      }
    });
  }

  #applyRecord(id: RecordChange["id"], record: ShiftEditorRecord | null): void {
    const valid = record ? this.#validRecord(record) : null;
    if (valid) {
      this.#store.put(valid);
    } else {
      this.#store.delete(id as ShiftEditorRecord["id"]);
    }
  }

  #validRecord(record: ShiftEditorRecord): ShiftEditorRecord | null {
    switch (record.type) {
      case "selection": {
        const ids = record.ids.filter((id) => this.#editor.object(id) !== null);
        return ids.length > 0 ? { ...record, ids } : null;
      }
      case "editing": {
        const nodeIds = record.nodeIds.filter((id) => this.#editor.scene.node(id) !== null);
        return nodeIds.length > 0 ? { ...record, nodeIds } : null;
      }
      default:
        return record;
    }
  }

  async #undoWorkspaceOnly(): Promise<boolean> {
    if (!this.#workspace) return false;

    const applied = await this.#workspace.undo();
    if (!applied) return false;

    this.#redoEntries.push({
      label: "Edit font",
      effects: [{ kind: "workspace" }],
    });
    return true;
  }

  async #redoWorkspaceOnly(): Promise<boolean> {
    if (!this.#workspace) return false;

    const applied = await this.#workspace.redo();
    if (!applied) return false;

    this.#undoEntries.push({
      label: "Edit font",
      effects: [{ kind: "workspace" }],
    });
    return true;
  }

  async #settled(): Promise<void> {
    await this.#workspace?.settled();
    if (this.#discardingRedo) await this.#discardingRedo;
  }

  #startDiscardRedo(): void {
    if (!this.#workspace || this.#discardingRedo) return;
    this.#discardingRedo = this.#discardRedo();
  }

  async #discardRedo(): Promise<void> {
    try {
      await this.#workspace?.discardRedo();
    } catch (error) {
      this.#undoEntries.length = 0;
      this.#redoEntries.length = 0;
      console.error("failed to align the workspace redo branch", error);
    } finally {
      this.#discardingRedo = null;
    }
  }

  #replaceEntry(previous: HistoryEntry, next: HistoryEntry): void {
    const index = this.#undoEntries.indexOf(previous);
    if (index >= 0) this.#undoEntries[index] = next;

    for (const pending of this.#pending.values()) {
      if (pending.entry === previous) pending.entry = next;
    }
  }

  #assertNoCapture(action: string): void {
    if (this.#capture) throw new Error(`cannot ${action} while an editor history capture is open`);
  }
}

function historyEffects(
  changes: readonly RecordChange[],
  workspaceEffects: readonly WorkspaceEffect[],
): HistoryEffect[] {
  const effects: HistoryEffect[] = [];
  if (changes.length > 0) effects.push({ kind: "records", changes });
  effects.push(...workspaceEffects);
  return effects;
}

function recordEffect(entry: HistoryEntry): RecordHistoryEffect | null {
  return entry.effects.find((effect) => effect.kind === "records") ?? null;
}

function workspaceEffectCount(entry: HistoryEntry): number {
  return entry.effects.filter((effect) => effect.kind === "workspace").length;
}

function hasWorkspaceEffect(entry: HistoryEntry): boolean {
  return workspaceEffectCount(entry) > 0;
}

function replaceRecordEffect(
  entry: HistoryEntry,
  changes: readonly RecordChange[],
): HistoryEntry | null {
  const effects: HistoryEffect[] = [];
  for (const effect of entry.effects) {
    if (effect.kind !== "records") {
      effects.push(effect);
    } else if (changes.length > 0) {
      effects.push({ ...effect, changes });
    }
  }

  return effects.length > 0 ? { ...entry, effects } : null;
}
