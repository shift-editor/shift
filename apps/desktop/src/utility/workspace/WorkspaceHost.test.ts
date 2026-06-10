import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Channel, nodePortTransport, type Transport } from "../../shared/workspace/channel";
import type {
  ShellCallMap,
  ShellEventMap,
  SyncCallMap,
  SyncEventMap,
} from "../../shared/workspace/protocol";
import { WorkspaceHost } from "./WorkspaceHost";

type ShellChannel = Channel<ShellCallMap, ShellEventMap>;
type SyncChannel = Channel<SyncCallMap, SyncEventMap>;

describe("WorkspaceHost serves the workspace over transferred ports", () => {
  let tmpRoot: string;
  let shell: ShellChannel;
  const channels: Array<ShellChannel | SyncChannel> = [];

  function startHost(shellTransport: Transport): void {
    new WorkspaceHost({
      documentsRoot: tmpRoot,
      shell: shellTransport,
      syncTransport: (port) => nodePortTransport(port as NodeMessagePort),
    }).start();
  }

  async function connectSyncLane(): Promise<SyncChannel> {
    const lane = new MessageChannel();
    await shell.call("workspace.connect", undefined, [lane.port1]);

    const sync: SyncChannel = new Channel(nodePortTransport(lane.port2));
    channels.push(sync);
    return sync;
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shift-workspace-host-"));
    const lane = new MessageChannel();

    shell = new Channel(nodePortTransport(lane.port1));
    channels.push(shell);
    startHost(nodePortTransport(lane.port2));
  });

  afterEach(() => {
    for (const channel of channels.splice(0)) channel.dispose();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("emits ready after start", async () => {
    const lane = new MessageChannel();
    const client: ShellChannel = new Channel(nodePortTransport(lane.port1));
    channels.push(client);
    const ready = new Promise<void>((resolve) => client.listen("ready", resolve));

    startHost(nodePortTransport(lane.port2));

    await expect(ready).resolves.toBeUndefined();
  });

  it("clears stale drafts on start", () => {
    const stale = path.join(tmpRoot, "drafts", "stale-draft");
    fs.mkdirSync(stale, { recursive: true });

    const lane = new MessageChannel();
    startHost(nodePortTransport(lane.port2));

    expect(fs.existsSync(stale)).toBe(false);
  });

  it("rejects workspace.connect without a transferred port", async () => {
    await expect(shell.call("workspace.connect", undefined)).rejects.toThrow(
      "requires a transferred sync-lane port",
    );
  });

  it("returns a null snapshot before any workspace exists", async () => {
    const sync = await connectSyncLane();

    await expect(sync.call("workspace.snapshot", undefined)).resolves.toBeNull();
  });

  it("creates an untitled workspace and returns it as the next state", async () => {
    const sync = await connectSyncLane();

    const snapshot = await sync.call("workspace.create", undefined);

    expect(snapshot.documentId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(snapshot.glyphs).toEqual([]);
    expect(snapshot.metrics.unitsPerEm).toBe(1000);
    expect(snapshot.sources.length).toBeGreaterThan(0);
  });

  it("writes the sqlite store under the documents root", async () => {
    const sync = await connectSyncLane();

    const { documentId } = await sync.call("workspace.create", undefined);

    const storePath = path.join(tmpRoot, "drafts", documentId, "document.sqlite");
    expect(fs.existsSync(storePath)).toBe(true);
  });

  it("workspace.snapshot returns the created workspace", async () => {
    const sync = await connectSyncLane();
    const created = await sync.call("workspace.create", undefined);

    await expect(sync.call("workspace.snapshot", undefined)).resolves.toEqual(created);
  });

  it("a reconnected sync lane still serves the open workspace", async () => {
    const first = await connectSyncLane();
    const created = await first.call("workspace.create", undefined);

    const second = await connectSyncLane();

    await expect(second.call("workspace.snapshot", undefined)).resolves.toEqual(created);
  });
});
