import type { ShiftHost } from "@shared/host/ShiftHost";
import type { WorkspaceDocumentState, WorkspacePreviewFont } from "@shared/workspace/protocol";
import type { SystemClipboard } from "@/lib/clipboard";
import { Editor } from "@/lib/editor/Editor";
import { Font } from "@/lib/model/Font";
import { FontStore } from "@/lib/model/FontStore";
import { registerBuiltInTools } from "@/lib/tools/tools";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import {
  WorkspaceEditCoordinator,
  type WorkspaceCommitState,
} from "@/lib/workspace/WorkspaceEditCoordinator";
import type { Signal } from "@/lib/signals/signal";
import { WorkspaceDocumentBridge } from "./WorkspaceDocumentBridge";

export interface WorkspaceOptions {
  readonly host: ShiftHost;
  readonly client: FontSessionClient;
  readonly clipboard: SystemClipboard;
}

export class Workspace {
  readonly #client: FontSessionClient;
  readonly #store: FontStore;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #documentBridge: WorkspaceDocumentBridge;
  #connection: Promise<void> | null = null;

  readonly font: Font;
  readonly editor: Editor;
  readonly documentStateCell: Signal<WorkspaceDocumentState | null>;
  readonly commitStateCell: Signal<WorkspaceCommitState>;

  constructor(options: WorkspaceOptions) {
    this.#client = options.client;
    this.#store = new FontStore();
    this.#edits = new WorkspaceEditCoordinator(this.#client, this.#store);
    this.#documentBridge = new WorkspaceDocumentBridge({
      host: options.host,
      edits: this.#edits,
    });

    this.font = new Font({ store: this.#store, editCoordinator: this.#edits });
    this.editor = new Editor({
      font: this.font,
      fontStore: this.#store,
      clipboard: options.clipboard,
    });
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

  /** Compiles the committed workspace for the spike DOM proof projection. */
  compilePreview(): Promise<WorkspacePreviewFont> {
    return this.#edits.compilePreview();
  }

  dispose(): void {
    this.font.dispose();
    this.#documentBridge.dispose();
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
