import type { ShiftHost } from "@shared/host/ShiftHost";
import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import type { SystemClipboard } from "@/lib/clipboard";
import { Editor } from "@/lib/editor/Editor";
import { Font } from "@/lib/model/Font";
import { FontStore } from "@/lib/model/FontStore";
import { GlyphSnapshotRequests } from "@/lib/model/GlyphSnapshotRequests";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { WorkspaceClient } from "@/lib/workspace/WorkspaceClient";
import {
  WorkspaceEditCoordinator,
  type WorkspaceCommitState,
} from "@/lib/workspace/WorkspaceEditCoordinator";
import type { Signal } from "@/lib/signals/signal";
import { WorkspaceDocumentBridge } from "./WorkspaceDocumentBridge";

export interface WorkspaceOptions {
  readonly host: ShiftHost;
  readonly clipboard: SystemClipboard;
}

export class Workspace {
  readonly #client: WorkspaceClient;
  readonly #store: FontStore;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #documentBridge: WorkspaceDocumentBridge;
  #connection: Promise<void> | null = null;

  readonly font: Font;
  readonly editor: Editor;
  readonly glyphSnapshots: GlyphSnapshotRequests;
  readonly documentStateCell: Signal<WorkspaceDocumentState | null>;
  readonly commitStateCell: Signal<WorkspaceCommitState>;

  constructor(options: WorkspaceOptions) {
    this.#client = new WorkspaceClient(options.host);
    this.#store = new FontStore();
    this.#edits = new WorkspaceEditCoordinator(this.#client, this.#store);
    this.#documentBridge = new WorkspaceDocumentBridge({
      host: options.host,
      edits: this.#edits,
    });

    this.font = new Font(this.#store, this.#edits);
    this.editor = new Editor({ font: this.font, clipboard: options.clipboard });
    this.glyphSnapshots = new GlyphSnapshotRequests(this.#store, this.#edits);
    this.documentStateCell = this.#client.documentStateCell;
    this.commitStateCell = this.#edits.commitStateCell;

    registerBuiltInTools(this.editor);
    this.editor.setActiveTool("select");
  }

  connect(): Promise<void> {
    if (!this.#connection) {
      this.#connection = this.#connect();
    }

    return this.#connection;
  }

  dispose(): void {
    this.#documentBridge.dispose();
    this.#client.dispose();
  }

  async #connect(): Promise<void> {
    try {
      await this.#client.connect();

      const snapshot = this.#client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace connected without a snapshot");
      }

      this.#store.replaceWorkspace(snapshot);
      await this.#documentBridge.connect();
    } catch (error) {
      this.#connection = null;
      throw error;
    }
  }
}
