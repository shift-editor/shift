import type { ShiftHost } from "@shared/host/ShiftHost";
import type { DocumentCallMap, DocumentEventMap } from "@shared/ipc/contract";
import { domPortTransport, serveChannel, type ChannelServer } from "@shared/workspace/channel";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";

interface WorkspaceDocumentBridgeOptions {
  readonly host: ShiftHost;
  readonly edits: WorkspaceEditCoordinator;
}

export class WorkspaceDocumentBridge {
  readonly #host: ShiftHost;
  readonly #edits: WorkspaceEditCoordinator;
  #requests: ChannelServer<DocumentEventMap> | null = null;

  constructor(options: WorkspaceDocumentBridgeOptions) {
    this.#host = options.host;
    this.#edits = options.edits;
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
        "document.state": () => this.#edits.state(),
        "document.save": ({ path }) => this.#edits.save(path),
      },
    );
  }

  dispose(): void {
    this.#requests?.dispose();
    this.#requests = null;
  }
}

function nextDocumentPort(): { received: Promise<MessagePort>; cancel: () => void } {
  let cancel = () => {};

  const received = new Promise<MessagePort>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
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
