import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import {
  Channel,
  isRequestEnvelope,
  nodePortTransport,
  type ResponseEnvelope,
  type Transport,
  type TransportMessage,
} from "@shared/workspace/channel";
import { toTransportError } from "@shared/errors";
import type { ShellCallMap, ShellEventMap, SyncCallMap } from "@shared/workspace/protocol";
import { WorkspaceHost } from "../../../utility/workspace/WorkspaceHost";
import { Font, FontStore } from "@shift/editor/model";
import { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { WindowEngine } from "@/lib/engine/WindowEngine";
import { layerReaderHost } from "../../../preload/layerReaders";

export type WorkspaceStack = {
  client: FontSessionClient;
  store: FontStore;
  editCoordinator: WorkspaceEditCoordinator;
  font: Font;
  createWorkspace(): Promise<void>;
  openWorkspace(sourcePath: string): Promise<void>;
  /** Closes the workspace; `discard` drops unsaved edits instead of refusing to close. */
  closeWorkspace(discard?: boolean): Promise<void>;
  /**
   * Makes the workspace fail the next edit it is sent, as a write the store
   * refuses would, without applying it.
   */
  failNextPersist(): void;
  dispose(): void;
};

/**
 * The full production editing stack, in-process: real WorkspaceHost (real
 * NAPI, real SQLite in a temp dir) served over real node MessagePorts, with
 * the real client/editCoordinator/FontStore/Font wiring. No Electron, no mocks — the same
 * pattern as WorkspaceHost.test.ts, extended to the renderer side.
 */
export function createWorkspaceStack(): WorkspaceStack {
  const documentsRoot = mkdtempSync(join(tmpdir(), "shift-editor-stack-"));

  const shellLane = new MessageChannel();
  new WorkspaceHost({
    documentsRoot,
    atlasCacheRoot: join(documentsRoot, "atlas-cache"),
    shell: nodePortTransport(shellLane.port2),
    portTransport: (port) => nodePortTransport(port as NodeMessagePort),
  }).start();
  const shell = new Channel<ShellCallMap, ShellEventMap>(nodePortTransport(shellLane.port1));

  const refusals = { pending: 0 };
  const client = new FontSessionClient(null, {
    transport: async () => {
      const lane = new MessageChannel();
      await shell.call("workspace.connect", undefined, [lane.port1]);
      return refusingPersists(nodePortTransport(lane.port2), refusals);
    },
  });
  // The window's engine reads the same store through the preload's reader, as in production.
  const engine = new WindowEngine(layerReaderHost(), client);
  const store = new FontStore({ engine });
  const editCoordinator = new WorkspaceEditCoordinator(client, store, engine);
  const font = new Font({ store, glyphInfo: getGlyphInfo(), editCoordinator });

  return {
    client,
    store,
    editCoordinator,
    font,
    async createWorkspace(): Promise<void> {
      await shell.call("workspace.create", undefined);
      await client.connect();

      const snapshot = client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace stack connected without a snapshot");
      }

      store.replaceWorkspace(snapshot);
      await editCoordinator.reopenEngine();
    },
    async openWorkspace(sourcePath: string): Promise<void> {
      await shell.call("workspace.open", { path: sourcePath });
      await client.connect();

      const snapshot = client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace stack connected without a snapshot");
      }

      store.replaceWorkspace(snapshot);
      await editCoordinator.reopenEngine();
    },
    async closeWorkspace(discard = false): Promise<void> {
      await shell.call("workspace.close", { discard });
    },
    failNextPersist(): void {
      refusals.pending += 1;
    },
    dispose(): void {
      engine.dispose();
      client.dispose();
      shell.dispose();
      rmSync(documentsRoot, { recursive: true, force: true });
    },
  };
}

/**
 * `transport`, answering `refusals.pending` coming `workspace.persist`
 * requests with an error instead of sending them: a workspace failing an edit
 * for a reason the window's engine cannot see, such as a refused write.
 */
function refusingPersists(transport: Transport, refusals: { pending: number }): Transport {
  const listeners: ((message: TransportMessage) => void)[] = [];
  const persist: keyof SyncCallMap = "workspace.persist";
  return {
    ...transport,
    onMessage(listener) {
      listeners.push(listener);
      transport.onMessage(listener);
    },
    post(message, transfer) {
      if (refusals.pending > 0 && isRequestEnvelope(message) && message.type === persist) {
        refusals.pending -= 1;
        const response: ResponseEnvelope = {
          kind: "response",
          id: message.id,
          ok: false,
          error: toTransportError(new Error("the store refused the write")),
        };
        queueMicrotask(() => {
          for (const listener of listeners) listener({ data: response, ports: [] });
        });
        return;
      }
      transport.post(message, transfer);
    },
  };
}
