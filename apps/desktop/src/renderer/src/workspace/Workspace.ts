import type { GlyphInfo } from "@shift/glyph-info";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { FontStoreLocation, WorkspaceDocumentState } from "@shared/workspace/lanes";
import type { SystemClipboard } from "@shift/editor/clipboard";
import { Editor } from "@shift/editor";
import { Font, FontStore } from "@shift/editor/model";
import { registerBuiltInTools } from "@/lib/tools/tools";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import {
  WorkspaceEditCoordinator,
  type WorkspaceApplyStatus,
} from "@/lib/workspace/WorkspaceEditCoordinator";
import { computed, type Signal } from "@shift/editor/signals";
import { WindowEngine } from "@/lib/engine/WindowEngine";
import { WorkspaceDocumentBridge } from "./WorkspaceDocumentBridge";
import { WindowTabs } from "@/lib/tabs/WindowTabs";
import { WindowViewMemory } from "@/lib/tabs/WindowViewMemory";
import { documentViewKey } from "@/lib/workspace/documentViews";

export interface WorkspaceOptions {
  readonly host: ShiftHost;
  readonly client: FontSessionClient;
  readonly clipboard: SystemClipboard;
  readonly glyphInfo: GlyphInfo;
}

export class Workspace {
  readonly #client: FontSessionClient;
  readonly #store: FontStore;
  readonly #engine: WindowEngine;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #documentBridge: WorkspaceDocumentBridge;
  readonly #viewMemory: WindowViewMemory;
  #connection: Promise<void> | null = null;

  readonly font: Font;
  readonly editor: Editor;
  /** The window's tabs over this workspace's editor. */
  readonly tabs: WindowTabs;
  readonly documentStateCell: Signal<WorkspaceDocumentState | null>;
  readonly applyStatusCell: Signal<WorkspaceApplyStatus>;

  constructor(options: WorkspaceOptions) {
    this.#client = options.client;
    this.#engine = new WindowEngine(options.host.layers, this.#client);
    this.#store = new FontStore({ engine: this.#engine });
    this.#edits = new WorkspaceEditCoordinator(this.#client, this.#store, this.#engine);
    this.#documentBridge = new WorkspaceDocumentBridge({
      host: options.host,
      edits: this.#edits,
      flushView: () => this.#viewMemory.flush(),
    });

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
    });
    this.tabs = new WindowTabs(this.editor);
    this.documentStateCell = this.#client.documentStateCell;
    const documentStateCell = this.documentStateCell;
    this.#viewMemory = new WindowViewMemory(this.editor, this.tabs, {
      keyCell: computed(() => {
        const state = documentStateCell.value;
        return state ? documentViewKey(state) : null;
      }),
    });
    this.applyStatusCell = this.#edits.applyStatusCell;

    registerBuiltInTools(this.editor);
    this.editor.setActiveTool("select");
  }

  get editCoordinator(): WorkspaceEditCoordinator {
    return this.#edits;
  }

  /**
   * Where this workspace's store lives, so the window's editing engine can
   * read layers from it synchronously through `shiftHost.layers`.
   */
  storeLocation(): Promise<FontStoreLocation | null> {
    return this.#client.storeLocation();
  }

  connect(): Promise<void> {
    if (!this.#connection) {
      this.#connection = this.#connect();
    }

    return this.#connection;
  }

  dispose(): void {
    window.removeEventListener("blur", this.#flushViewOnLeave);
    window.removeEventListener("pagehide", this.#flushViewOnLeave);
    this.#viewMemory.dispose();
    this.font.dispose();
    this.#documentBridge.dispose();
    this.#engine.dispose();
  }

  // Leaving the window writes the view state still waiting for its quiet period.
  readonly #flushViewOnLeave = (): void => this.#viewMemory.flush();

  async #connect(): Promise<void> {
    try {
      await this.#client.connect();

      const snapshot = this.#client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace connected without a snapshot");
      }

      // The font shows once the engine is open: it reads the axes, sources
      // and kerning.
      await this.#edits.open(snapshot);
      this.#viewMemory.restore();
      window.addEventListener("blur", this.#flushViewOnLeave);
      window.addEventListener("pagehide", this.#flushViewOnLeave);
      await this.#documentBridge.connect();
    } catch (error) {
      this.#connection = null;
      throw error;
    }
  }
}
