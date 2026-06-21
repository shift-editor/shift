import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import { Channel, nodePortTransport } from "@shared/workspace/channel";
import type { ShellCallMap, ShellEventMap } from "@shared/workspace/protocol";
import { WorkspaceHost } from "../../../utility/workspace/WorkspaceHost";
import { Font } from "@/lib/model/Font";
import { FontStore } from "@/lib/model/FontStore";
import { GlyphSnapshotLoader } from "@/lib/model/GlyphSnapshotLoader";
import { WorkspaceClient } from "@/lib/workspace/WorkspaceClient";
import { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";

export type WorkspaceStack = {
  client: WorkspaceClient;
  store: FontStore;
  editCoordinator: WorkspaceEditCoordinator;
  glyphSnapshotLoader: GlyphSnapshotLoader;
  font: Font;
  createWorkspace(): Promise<void>;
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
    shell: nodePortTransport(shellLane.port2),
    syncTransport: (port) => nodePortTransport(port as NodeMessagePort),
  }).start();
  const shell = new Channel<ShellCallMap, ShellEventMap>(nodePortTransport(shellLane.port1));

  const client = new WorkspaceClient(null, {
    transport: async () => {
      const lane = new MessageChannel();
      await shell.call("workspace.connect", undefined, [lane.port1]);
      return nodePortTransport(lane.port2);
    },
  });
  const store = new FontStore();
  const editCoordinator = new WorkspaceEditCoordinator(client, store.sync);
  const glyphSnapshotLoader = new GlyphSnapshotLoader(store.glyphSnapshots, editCoordinator);
  const font = new Font(store, editCoordinator);

  return {
    client,
    store,
    editCoordinator,
    glyphSnapshotLoader,
    font,
    async createWorkspace(): Promise<void> {
      await shell.call("workspace.create", undefined);
      await client.connect();

      const snapshot = client.workspaceCell.peek();
      if (!snapshot) {
        throw new Error("workspace stack connected without a snapshot");
      }

      store.sync.replaceWorkspace(snapshot);
    },
  };
}
