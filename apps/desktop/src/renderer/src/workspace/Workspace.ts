import type { GlyphInfo } from "@shift/glyph-info";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { WorkspaceDocumentState } from "@shared/workspace/protocol";
import type { SystemClipboard } from "@shift/editor/clipboard";
import { Editor } from "@shift/editor";
import { Font, FontStore } from "@shift/editor/model";
import { registerBuiltInTools } from "@/lib/tools/tools";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import {
  WorkspaceEditCoordinator,
  type WorkspaceApplyStatus,
} from "@/lib/workspace/WorkspaceEditCoordinator";
import type { Signal } from "@shift/editor/signals";
import { workspaceSceneStateStore } from "@/lib/workspace/workspaceSceneStateStore";
import { WorkspaceDocumentBridge } from "./WorkspaceDocumentBridge";

export interface WorkspaceOptions {
  readonly host: ShiftHost;
  readonly client: FontSessionClient;
  readonly clipboard: SystemClipboard;
  readonly glyphInfo: GlyphInfo;
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
  readonly applyStatusCell: Signal<WorkspaceApplyStatus>;

  constructor(options: WorkspaceOptions) {
    this.#client = options.client;
    this.#store = new FontStore();
    this.#edits = new WorkspaceEditCoordinator(this.#client, this.#store);

    this.font = new Font({
      store: this.#store,
      glyphInfo: options.glyphInfo,
      editCoordinator: this.#edits,
    });
    this.editor = new Editor({
      font: this.font,
      fontStore: this.#store,
      clipboard: options.clipboard,
      sessionMode: "workspace",
      sceneState: { store: workspaceSceneStateStore(this.#client, this.#edits) },
    });
    this.#documentBridge = new WorkspaceDocumentBridge({
      host: options.host,
      edits: this.#edits,
      flushScene: () => this.#flushScene(),
    });
    this.documentStateCell = this.#client.documentStateCell;
    this.applyStatusCell = this.#edits.applyStatusCell;

    registerBuiltInTools(this.editor);
    this.editor.setActiveTool("select");
  }

  get editCoordinator(): WorkspaceEditCoordinator {
    return this.#edits;
  }

  connect(): Promise<void> {
    if (!this.#connection) {
      this.#connection = this.#connect();
    }

    return this.#connection;
  }

  dispose(): void {
    window.removeEventListener("blur", this.#flushSceneOnLeave);
    window.removeEventListener("pagehide", this.#flushSceneOnLeave);
    this.font.dispose();
    this.#documentBridge.dispose();
  }

  /** Writes any canvas change still waiting for its quiet period. */
  #flushScene(): Promise<void> {
    return this.editor.scenePersistence?.flush() ?? Promise.resolve();
  }

  // Leaving the window is a fire-and-forget boundary; flush logs its own failures.
  readonly #flushSceneOnLeave = (): void => {
    void this.#flushScene();
  };

  async #connect(): Promise<void> {
    try {
      await this.#client.connect();

      const snapshot = this.#client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace connected without a snapshot");
      }

      this.#store.replaceWorkspace(snapshot);
      await this.editor.scenePersistence?.restore();
      window.addEventListener("blur", this.#flushSceneOnLeave);
      window.addEventListener("pagehide", this.#flushSceneOnLeave);
      await this.#documentBridge.connect();
    } catch (error) {
      this.#connection = null;
      throw error;
    }
  }
}
