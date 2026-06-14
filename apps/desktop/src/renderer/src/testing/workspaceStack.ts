import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import { Channel, nodePortTransport } from "@shared/workspace/channel";
import type { ShellCallMap, ShellEventMap } from "@shared/workspace/protocol";
import { WorkspaceHost } from "../../../utility/workspace/WorkspaceHost";
import { WorkspaceClient } from "@/lib/workspace/WorkspaceClient";
import { WorkspaceEditQueue } from "@/lib/workspace/WorkspaceEditQueue";
import { Font } from "@/lib/model/Font";

export type WorkspaceStack = {
  client: WorkspaceClient;
  editQueue: WorkspaceEditQueue;
  font: Font;
};

/**
 * The full production editing stack, in-process: real WorkspaceHost (real
 * NAPI, real SQLite in a temp dir) served over real node MessagePorts, with
 * the real client/editQueue/font wiring. No Electron, no mocks — the same
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
  const editQueue = new WorkspaceEditQueue(client);
  const font = new Font(client.$workspace, editQueue);

  return { client, editQueue, font };
}
