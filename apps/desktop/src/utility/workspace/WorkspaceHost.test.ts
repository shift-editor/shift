import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Channel, nodePortTransport, type Transport } from "../../shared/workspace/channel";
import { mintContourId, mintPointId, type GlyphId, type PointType } from "@shift/types";
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

  it("apply createGlyph echoes records and a structural layer", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);

    const applied = await sync.call("workspace.apply", {
      intents: [{ kind: "createGlyph", name: "A", unicodes: [65] }],
      label: "Add Glyph",
    });

    expect(applied.glyphs?.map((glyph) => glyph.name)).toEqual(["A"]);
    expect(applied.layers).toHaveLength(1);
    expect(applied.layers[0].structure).toBeDefined();

    const snapshot = await sync.call("workspace.snapshot", undefined);
    expect(snapshot?.glyphs.map((glyph) => glyph.name)).toEqual(["A"]);
  });

  it("apply setXAdvance echoes values without structure or records", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);
    const created = await sync.call("workspace.apply", {
      intents: [{ kind: "createGlyph", name: "A", unicodes: [65] }],
    });
    const layerId = created.layers[0].layerId;

    const applied = await sync.call("workspace.apply", {
      intents: [{ kind: "setXAdvance", layerId, width: 642 }],
    });

    expect(applied.glyphs).toBeUndefined();
    expect(applied.layers[0].layerId).toBe(layerId);
    expect(applied.layers[0].structure).toBeUndefined();
    expect(applied.layers[0].values[0]).toBe(642);
  });

  it("apply rejects unknown intent kinds with a channel error", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);

    await expect(
      sync.call("workspace.apply", { intents: [{ kind: "explodeFont" }] }),
    ).rejects.toThrow("explodeFont");
  });

  it("pen intents apply atomically with client-minted ids through the channel", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);
    const created = await sync.call("workspace.apply", {
      intents: [{ kind: "createGlyph", name: "A", unicodes: [65] }],
    });
    const layerId = created.layers[0].layerId;

    const contourId = mintContourId();
    const p1 = mintPointId();
    const p2 = mintPointId();

    const applied = await sync.call("workspace.apply", {
      intents: [
        { kind: "addContour", addContour: { layerId, contourId, closed: false } },
        {
          kind: "addPoints",
          addPoints: {
            layerId,
            contourId,
            points: [
              { id: p1, x: 10, y: 20, pointType: "onCurve" as PointType, smooth: false },
              { id: p2, x: 30, y: 40, pointType: "onCurve" as PointType, smooth: false },
            ],
          },
        },
        { kind: "setContourClosed", setContourClosed: { layerId, contourId, closed: true } },
      ],
      label: "Draw Contour",
    });

    expect(applied.layers).toHaveLength(1);
    const structure = applied.layers[0].structure;
    expect(structure?.contours[0].id).toBe(contourId);
    expect(structure?.contours[0].closed).toBe(true);
    expect(structure?.contours[0].points.map((point) => point.id)).toEqual([p1, p2]);
    expect(applied.glyphs).toBeUndefined();
    expect(applied.dependents).toEqual([]);
  });

  it("undo and redo replay ledger entries through the channel", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);
    const created = await sync.call("workspace.apply", {
      intents: [{ kind: "createGlyph", name: "A", unicodes: [65] }],
    });
    const layerId = created.layers[0].layerId;
    const contourId = mintContourId();
    const p1 = mintPointId();

    await sync.call("workspace.apply", {
      intents: [
        { kind: "addContour", addContour: { layerId, contourId, closed: false } },
        {
          kind: "addPoints",
          addPoints: {
            layerId,
            contourId,
            points: [{ id: p1, x: 10, y: 20, pointType: "onCurve" as PointType, smooth: false }],
          },
        },
      ],
      label: "Draw",
    });

    const undone = await sync.call("workspace.undo", undefined);
    expect(undone?.layers[0].structure?.contours).toEqual([]);

    const redone = await sync.call("workspace.redo", undefined);
    expect(redone?.layers[0].structure?.contours[0].points.map((point) => point.id)).toEqual([p1]);
  });

  it("undo on an empty ledger answers null", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);

    await expect(sync.call("workspace.undo", undefined)).resolves.toBeNull();
    await expect(sync.call("workspace.redo", undefined)).resolves.toBeNull();
  });

  it("workspace.glyph pulls replace-grade state by stable id", async () => {
    const sync = await connectSyncLane();
    const snapshot = await sync.call("workspace.create", undefined);
    const sourceId = snapshot.sources[0].id;
    const created = await sync.call("workspace.apply", {
      intents: [{ kind: "createGlyph", name: "A", unicodes: [65] }],
    });
    const glyphId = created.glyphs?.[0].id;
    if (!glyphId) throw new Error("createGlyph must echo the record id");

    const state = await sync.call("workspace.glyph", { glyphId, sourceId });
    expect(state?.layerId).toBe(created.layers[0].layerId);
    expect(state?.structure.contours).toEqual([]);

    const missing = `glyph_${crypto.randomUUID()}` as GlyphId;
    await expect(sync.call("workspace.glyph", { glyphId: missing, sourceId })).resolves.toBeNull();
  });

  it("CS0 skeleton: measures the apply round trip through the full stack", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);
    const created = await sync.call("workspace.apply", {
      intents: [{ kind: "createGlyph", name: "A", unicodes: [65] }],
    });
    const layerId = created.layers[0].layerId;

    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await sync.call("workspace.apply", {
        intents: [{ kind: "setXAdvance", layerId, width: 500 + i }],
      });
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[49];
    const p99 = samples[98];
    console.info(
      `[CS0] apply round trip (channel+NAPI+SQLite): p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms`,
    );

    // Generous bound — guards order-of-magnitude regressions, not jitter.
    // The recorded numbers live in the CS ticket.
    expect(p99).toBeLessThan(50);
  });
});
