import type { ShiftHost } from "@shared/host/ShiftHost";
import type { DocumentCallMap, DocumentEventMap } from "@shared/ipc/contract";
import { domPortTransport, serveChannel, type ChannelServer } from "@shared/workspace/channel";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";

interface WorkspaceDocumentBridgeOptions {
  readonly host: ShiftHost;
  readonly edits: WorkspaceEditCoordinator;
  /** Writes a pending canvas change; runs before every state read and save. */
  readonly flushScene: () => Promise<void>;
}

export class WorkspaceDocumentBridge {
  readonly #host: ShiftHost;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #flushScene: () => Promise<void>;
  #requests: ChannelServer<DocumentEventMap> | null = null;

  constructor(options: WorkspaceDocumentBridgeOptions) {
    this.#host = options.host;
    this.#edits = options.edits;
    this.#flushScene = options.flushScene;
  }

  async connect(): Promise<void> {
    const port = nextDocumentPort();

    try {
      await this.#host.document.connect();
    } catch (error) {
      port.cancel();
      throw error;
    }

    this.#requests?.dispose();
    this.#requests = serveChannel<DocumentCallMap, DocumentEventMap>(
      domPortTransport(await port.received),
      {
        // Main reads state before closing or quitting, so a pending canvas
        // change is written (and makes the document dirty) before it decides.
        "document.state": async () => {
          await this.#flushScene();
          return this.#edits.state();
        },
        "document.save": async ({ path }) => {
          await this.#flushScene();
          return this.#edits.save(path);
        },
        "document.export": ({ path }) => this.#edits.export(path),
        "document.releaseStore": () => this.#edits.releaseStore(),
      },
    );
  }

  dispose(): void {
    this.#requests?.dispose();
    this.#requests = null;
  }
}

function nextDocumentPort(): {
  received: Promise<MessagePort>;
  cancel: () => void;
} {
  let cancel = () => {};

  const received = new Promise<MessagePort>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if ((event.data as { type?: string } | null)?.type !== "document.port") return;

      const port = event.ports[0];
      if (!port) return;

      window.removeEventListener("message", listener);
      resolve(port);
    };

    cancel = () => window.removeEventListener("message", listener);
    window.addEventListener("message", listener);
  });

  return { received, cancel };
}
