import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Channel, nodePortTransport, type Transport } from "../../shared/workspace/channel";
import {
  mintContourId,
  mintGlyphId,
  mintLayerId,
  mintPointId,
  type FontIntent,
  type GlyphId,
  type GlyphName,
  type LayerId,
  type PointType,
  type SourceId,
  type Unicode,
} from "@shift/types";
import type {
  ShellCallMap,
  ShellEventMap,
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentState,
} from "../../shared/workspace/protocol";
import { WorkspaceHost } from "./WorkspaceHost";

type ShellChannel = Channel<ShellCallMap, ShellEventMap>;

const createGlyphA = (glyphId: GlyphId = mintGlyphId()): FontIntent => ({
  kind: "createGlyph",
  createGlyph: {
    glyphId,
    name: "A" as GlyphName,
    unicodes: [65 as Unicode],
  },
});

const createGlyphLayer = (
  glyphId: GlyphId,
  sourceId: SourceId,
  layerId: LayerId = mintLayerId(),
): FontIntent => ({
  kind: "createGlyphLayer",
  createGlyphLayer: { layerId, glyphId, sourceId },
});

function createGlyphALayer(sourceId: SourceId): {
  glyphId: GlyphId;
  layerId: LayerId;
  intents: FontIntent[];
} {
  const glyphId = mintGlyphId();
  const layerId = mintLayerId();
  return {
    glyphId,
    layerId,
    intents: [createGlyphA(glyphId), createGlyphLayer(glyphId, sourceId, layerId)],
  };
}
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

  async function connectSyncLane(targetShell: ShellChannel = shell): Promise<SyncChannel> {
    const lane = new MessageChannel();
    await targetShell.call("workspace.connect", undefined, [lane.port1]);

    const sync: SyncChannel = new Channel(nodePortTransport(lane.port2));
    channels.push(sync);
    return sync;
  }

  async function applyWorkspace(
    sync: SyncChannel,
    request: SyncCallMap["workspace.apply"]["request"],
  ): Promise<SyncCallMap["workspace.apply"]["response"]["applied"]> {
    return (await sync.call("workspace.apply", request)).applied;
  }

  async function undoWorkspace(
    sync: SyncChannel,
  ): Promise<SyncCallMap["workspace.undo"]["response"]["applied"]> {
    return (await sync.call("workspace.undo", undefined)).applied;
  }

  async function redoWorkspace(
    sync: SyncChannel,
  ): Promise<SyncCallMap["workspace.redo"]["response"]["applied"]> {
    return (await sync.call("workspace.redo", undefined)).applied;
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

  it("retains existing drafts across host restarts", async () => {
    // An authored draft must never die with the process: the data-loss
    // class the durability ADRs were written against.
    const sync = await connectSyncLane();
    const { documentId } = await sync.call("workspace.create", undefined);
    const storePath = path.join(tmpRoot, "drafts", documentId, "document.sqlite");
    expect(fs.existsSync(storePath)).toBe(true);

    const lane = new MessageChannel();
    startHost(nodePortTransport(lane.port2));

    expect(fs.existsSync(storePath)).toBe(true);
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

  it("returns null document state before any workspace exists", async () => {
    await expect(shell.call("document.state", undefined)).resolves.toBeNull();
  });

  it("creates an untitled workspace and returns it as the next state", async () => {
    const sync = await connectSyncLane();

    const snapshot = await sync.call("workspace.create", undefined);

    expect(snapshot.documentId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(snapshot.glyphs).toEqual([]);
    expect(snapshot.metrics.unitsPerEm).toBe(1000);
    expect(snapshot.sources.length).toBeGreaterThan(0);
    expect(snapshot.axes).toEqual([]);
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

  it("opens a package before any workspace exists", async () => {
    const source = await connectSyncLane();
    await source.call("workspace.create", undefined);
    await source.call("workspace.apply", { intents: [createGlyphA()], label: "Add Glyph" });
    const savePath = path.join(tmpRoot, "OpenMe.shift");
    await source.call("workspace.saveAs", { path: savePath });

    const lane = new MessageChannel();
    const unopenedShell: ShellChannel = new Channel(nodePortTransport(lane.port1));
    channels.push(unopenedShell);
    startHost(nodePortTransport(lane.port2));
    const unopened = await connectSyncLane(unopenedShell);

    const opened = await unopened.call("workspace.open", { path: savePath });

    expect(opened.documentId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(opened.sources.length).toBeGreaterThan(0);
    expect(opened.glyphs.map((glyph) => glyph.name)).toEqual(["A"]);
    await expect(unopenedShell.call("document.state", undefined)).resolves.toMatchObject({
      sourceKind: "package",
      saveTarget: savePath,
      dirty: false,
      needsSaveAs: false,
    });
  });

  it("opening a package resumes a retained dirty working store", async () => {
    const source = await connectSyncLane();
    const created = await source.call("workspace.create", undefined);
    await source.call("workspace.apply", { intents: [createGlyphA()], label: "Add Glyph" });
    const savePath = path.join(tmpRoot, "RecoverMe.shift");
    await source.call("workspace.saveAs", { path: savePath });
    await source.call("workspace.apply", {
      intents: [
        {
          kind: "createGlyph",
          createGlyph: {
            glyphId: mintGlyphId(),
            name: "B" as GlyphName,
            unicodes: [66 as Unicode],
          },
        },
      ],
      label: "Add Glyph",
    });

    const lane = new MessageChannel();
    const restartedShell: ShellChannel = new Channel(nodePortTransport(lane.port1));
    channels.push(restartedShell);
    startHost(nodePortTransport(lane.port2));
    const restarted = await connectSyncLane(restartedShell);

    const opened = await restarted.call("workspace.open", { path: savePath });

    expect(opened.documentId).toBe(created.documentId);
    expect(opened.glyphs.map((glyph) => glyph.name)).toEqual(["A", "B"]);
    await expect(restartedShell.call("document.state", undefined)).resolves.toMatchObject({
      documentId: created.documentId,
      sourceKind: "package",
      saveTarget: savePath,
      dirty: true,
      needsSaveAs: false,
    });
  });

  it("emits utility-owned document state after create and apply", async () => {
    let latestState: WorkspaceDocumentState | null = null;
    const unlisten = shell.listen("document.changed", (state) => {
      latestState = state;
    });
    const sync = await connectSyncLane();

    const created = await sync.call("workspace.create", undefined);
    await shell.call("document.state", undefined);
    expect(latestState).toMatchObject({
      documentId: created.documentId,
      sourceKind: "untitled",
      saveTarget: null,
      dirty: false,
      needsSaveAs: true,
    });

    const applied = await sync.call("workspace.apply", {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });
    expect(applied.documentState).toMatchObject({
      dirty: true,
      needsSaveAs: true,
    });
    await shell.call("document.state", undefined);
    expect(latestState).toMatchObject({
      dirty: true,
      needsSaveAs: true,
    });

    unlisten();
  });

  it("a reconnected sync lane still serves the open workspace", async () => {
    const first = await connectSyncLane();
    const created = await first.call("workspace.create", undefined);

    const second = await connectSyncLane();

    await expect(second.call("workspace.snapshot", undefined)).resolves.toEqual(created);
  });

  it("apply createGlyph echoes identity records without layers", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);

    const applied = await applyWorkspace(sync, {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });

    expect(applied.glyphs?.map((glyph) => glyph.name)).toEqual(["A"]);
    expect(applied.glyphs?.[0]?.layers).toEqual([]);
    expect(applied.layers).toEqual([]);

    const snapshot = await sync.call("workspace.snapshot", undefined);
    expect(snapshot?.glyphs.map((glyph) => glyph.name)).toEqual(["A"]);
    expect(snapshot?.glyphs[0]?.layers).toEqual([]);
  });

  it("apply createGlyphLayer echoes sparse membership and a structural layer", async () => {
    const sync = await connectSyncLane();
    const snapshot = await sync.call("workspace.create", undefined);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);

    const applied = await applyWorkspace(sync, {
      intents,
      label: "Add Glyph Layer",
    });

    expect(applied.glyphs?.[0]?.layers).toEqual([
      { id: layerId, sourceId: snapshot.sources[0].id },
    ]);
    expect(applied.layers).toHaveLength(1);
    expect(applied.layers[0].layerId).toBe(layerId);
    expect(applied.layers[0].structure).toBeDefined();
  });

  it("workspace.save reports NeedsSaveAs for untitled workspaces", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);
    await applyWorkspace(sync, {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });

    await expect(sync.call("workspace.save", undefined)).rejects.toThrow(
      "workspace needs a save path",
    );

    await expect(shell.call("document.state", undefined)).resolves.toMatchObject({
      dirty: true,
      needsSaveAs: true,
    });
  });

  it("workspace.saveAs writes the package and clears dirty for later saves", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);
    await applyWorkspace(sync, {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });

    const savePath = path.join(tmpRoot, "SavedFont.shift");
    const saved = await sync.call("workspace.saveAs", { path: savePath });

    expect(saved).toMatchObject({
      sourceKind: "package",
      saveTarget: savePath,
      dirty: false,
      needsSaveAs: false,
    });
    expect(fs.existsSync(savePath)).toBe(true);

    await applyWorkspace(sync, {
      intents: [
        {
          kind: "createGlyph",
          createGlyph: {
            glyphId: mintGlyphId(),
            name: "B" as GlyphName,
            unicodes: [66 as Unicode],
          },
        },
      ],
      label: "Add Glyph",
    });
    await expect(shell.call("document.state", undefined)).resolves.toMatchObject({
      dirty: true,
    });

    await expect(sync.call("workspace.save", undefined)).resolves.toMatchObject({
      dirty: false,
      needsSaveAs: false,
    });
  });

  it("serializes a save behind an un-awaited apply on the same lane", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);
    const savePath = path.join(tmpRoot, "Ordered.shift");

    // Issue the apply and the save back-to-back without awaiting the apply. The
    // host serializes both on one queue, so the save observes the glyph — if it
    // had raced ahead, the doc would read dirty once the apply landed.
    const apply = applyWorkspace(sync, { intents: [createGlyphA()], label: "Add Glyph" });
    const saved = await sync.call("workspace.saveAs", { path: savePath });
    await apply;

    expect(saved).toMatchObject({ dirty: false, needsSaveAs: false });
    await expect(shell.call("document.state", undefined)).resolves.toMatchObject({
      dirty: false,
    });
  });

  it("undo and redo createGlyph update glyph records", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);

    const created = await applyWorkspace(sync, {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });
    const glyphId = created.glyphs?.[0].id;
    if (!glyphId) throw new Error("createGlyph must echo the record id");

    const undone = await undoWorkspace(sync);
    expect(undone?.glyphs?.map((glyph) => glyph.name)).toEqual([]);
    expect(undone?.layers).toEqual([]);
    await expect(sync.call("workspace.snapshot", undefined)).resolves.toMatchObject({
      glyphs: [],
    });

    const redone = await redoWorkspace(sync);
    expect(redone?.glyphs?.map((glyph) => glyph.name)).toEqual(["A"]);
    expect(redone?.glyphs?.[0]?.layers).toEqual([]);
    expect(redone?.layers).toEqual([]);
    await expect(sync.call("workspace.snapshot", undefined)).resolves.toMatchObject({
      glyphs: [{ id: glyphId, name: "A", layers: [] }],
    });
  });

  it("apply setXAdvance echoes values without structure or records", async () => {
    const sync = await connectSyncLane();
    const snapshot = await sync.call("workspace.create", undefined);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);
    const created = await applyWorkspace(sync, {
      intents,
    });
    expect(created.layers[0].layerId).toBe(layerId);

    const applied = await applyWorkspace(sync, {
      intents: [{ kind: "setXAdvance", setXAdvance: { layerId, width: 642 } }],
    });

    expect(applied.glyphs).toBeUndefined();
    expect(applied.layers[0].layerId).toBe(layerId);
    expect(applied.layers[0].structure).toBeUndefined();
    expect(applied.layers[0].values[0]).toBe(642);
  });

  it("apply rejects unknown intent kinds with a channel error", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);

    await expect(applyWorkspace(sync, { intents: [{ kind: "explodeFont" }] })).rejects.toThrow(
      "explodeFont",
    );
  });

  it("pen intents apply atomically with client-minted ids through the channel", async () => {
    const sync = await connectSyncLane();
    const snapshot = await sync.call("workspace.create", undefined);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);
    const created = await applyWorkspace(sync, {
      intents,
    });
    expect(created.layers[0].layerId).toBe(layerId);

    const contourId = mintContourId();
    const p1 = mintPointId();
    const p2 = mintPointId();

    const applied = await applyWorkspace(sync, {
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
    const snapshot = await sync.call("workspace.create", undefined);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);
    const created = await applyWorkspace(sync, {
      intents,
    });
    expect(created.layers[0].layerId).toBe(layerId);
    const contourId = mintContourId();
    const p1 = mintPointId();

    await applyWorkspace(sync, {
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

    const undone = await undoWorkspace(sync);
    expect(undone?.layers[0].structure?.contours).toEqual([]);

    const redone = await redoWorkspace(sync);
    expect(redone?.layers[0].structure?.contours[0].points.map((point) => point.id)).toEqual([p1]);
  });

  it("undo on an empty ledger answers null", async () => {
    const sync = await connectSyncLane();
    await sync.call("workspace.create", undefined);

    await expect(undoWorkspace(sync)).resolves.toBeNull();
    await expect(redoWorkspace(sync)).resolves.toBeNull();
  });

  it("workspace.layer pulls replace-grade state by stable layer id", async () => {
    const sync = await connectSyncLane();
    const snapshot = await sync.call("workspace.create", undefined);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);
    const created = await applyWorkspace(sync, {
      intents,
    });
    expect(created.glyphs?.[0]?.layers).toEqual([
      { id: layerId, sourceId: snapshot.sources[0].id },
    ]);

    const state = await sync.call("workspace.layer", { layerId });
    expect(state?.layerId).toBe(layerId);
    expect(state?.structure.contours).toEqual([]);

    const missing = mintLayerId();
    await expect(sync.call("workspace.layer", { layerId: missing })).resolves.toBeNull();
  });

  it("CS0 skeleton: measures the apply round trip through the full stack", async () => {
    const sync = await connectSyncLane();
    const snapshot = await sync.call("workspace.create", undefined);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);
    const created = await applyWorkspace(sync, {
      intents,
    });
    expect(created.layers[0].layerId).toBe(layerId);

    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await applyWorkspace(sync, {
        intents: [{ kind: "setXAdvance", setXAdvance: { layerId, width: 500 + i } }],
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
