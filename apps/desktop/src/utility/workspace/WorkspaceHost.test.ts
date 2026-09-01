import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createBridge } from "@shift/bridge";
import { MessageChannel, type MessagePort as NodeMessagePort } from "node:worker_threads";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  ByteStreamControl,
  ByteStreamMessage,
  ShellCallMap,
  ShellEventMap,
  SlugAtlasOrigin,
  SyncCallMap,
  SyncEventMap,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
} from "../../shared/workspace/protocol";
import { WorkspaceHost } from "./WorkspaceHost";

type ShellChannel = Channel<ShellCallMap, ShellEventMap>;

const retainedFontPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../renderer/src/assets/fonts/HostGrotesk-VariableFont_wght.ttf",
);
const convertibleFontPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../fixtures/fonts/mutatorsans/MutatorSansLightCondensed.ufo",
);

const createGlyph = (
  name: GlyphName,
  unicode: Unicode,
  glyphId: GlyphId = mintGlyphId(),
): FontIntent => ({
  kind: "createGlyph",
  createGlyph: {
    glyphId,
    name,
    unicodes: [unicode],
  },
});

const createGlyphA = (glyphId: GlyphId = mintGlyphId()): FontIntent =>
  createGlyph("A" as GlyphName, 65 as Unicode, glyphId);

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
      atlasCacheRoot: path.join(tmpRoot, "atlas-cache"),
      shell: shellTransport,
      portTransport: (port) => nodePortTransport(port as NodeMessagePort),
    }).start();
  }

  async function connectSyncLane(targetShell: ShellChannel = shell): Promise<SyncChannel> {
    const lane = new MessageChannel();
    await targetShell.call("workspace.connect", undefined, [lane.port1]);

    const sync: SyncChannel = new Channel(nodePortTransport(lane.port2));
    channels.push(sync);
    return sync;
  }

  async function startAdditionalHost(): Promise<{
    shell: ShellChannel;
    sync: SyncChannel;
  }> {
    const lane = new MessageChannel();
    const additionalShell: ShellChannel = new Channel(nodePortTransport(lane.port1));
    channels.push(additionalShell);
    startHost(nodePortTransport(lane.port2));
    return { shell: additionalShell, sync: await connectSyncLane(additionalShell) };
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

  async function streamSlugAtlas(
    sync: SyncChannel,
    generation: number,
    maximumLength: number,
    pageOrigin: SlugAtlasOrigin | "source" | null = null,
  ): Promise<Uint8Array> {
    const lane = new MessageChannel();
    const chunks: Uint8Array[] = [];
    let receivedLength = 0;
    const complete = new Promise<number>((resolve, reject) => {
      lane.port2.onmessage = (event: MessageEvent<ByteStreamMessage>) => {
        switch (event.data.kind) {
          case "chunk":
            if (event.data.offset !== receivedLength) {
              reject(
                new Error(`Slug chunk started at ${event.data.offset}, not ${receivedLength}`),
              );
              lane.port2.close();
              return;
            }
            if (event.data.bytes.byteLength > maximumLength) {
              reject(new Error(`Slug chunk exceeded ${maximumLength} bytes`));
              lane.port2.close();
              return;
            }
            chunks.push(event.data.bytes);
            receivedLength += event.data.bytes.byteLength;
            lane.port2.postMessage({
              kind: "ack",
              nextOffset: receivedLength,
            } satisfies ByteStreamControl);
            return;
          case "complete":
            if (event.data.totalLength !== receivedLength) {
              reject(
                new Error(
                  `Slug stream completed at ${event.data.totalLength}, not ${receivedLength}`,
                ),
              );
              return;
            }
            resolve(event.data.totalLength);
            return;
          case "error":
            reject(new Error(event.data.message));
        }
      };
    });
    lane.port2.start();
    if (pageOrigin === "source") {
      await sync.call("source.atlasPageStream", { generation, maximumLength }, [lane.port1]);
    } else if (pageOrigin) {
      await sync.call(
        "workspace.slugAtlasPageStream",
        { generation, origin: pageOrigin, maximumLength },
        [lane.port1],
      );
    } else {
      await sync.call("workspace.slugAtlasStream", { generation, maximumLength }, [lane.port1]);
    }
    const totalLength = await complete;
    lane.port2.close();

    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  function corruptAtlasCacheIndex(): void {
    const cacheRoot = path.join(tmpRoot, "atlas-cache");
    const fileName = fs.readdirSync(cacheRoot).find((name) => name.endsWith(".atlas"));
    if (!fileName) throw new Error("expected a published CachedAtlas");

    const filePath = path.join(cacheRoot, fileName);
    const bytes = fs.readFileSync(filePath);
    bytes[12] ^= 0xff;
    fs.writeFileSync(filePath, bytes);
  }

  async function createWorkspace(
    sync: SyncChannel,
    targetShell: ShellChannel = shell,
  ): Promise<WorkspaceSnapshot> {
    const state = await targetShell.call("workspace.create", undefined);
    const snapshot = await sync.call("workspace.snapshot", undefined);
    if (!snapshot) throw new Error("workspace.create did not create a snapshot");
    expect(snapshot.workspaceId).toBe(state.workspaceId);
    return snapshot;
  }

  async function openWorkspace(
    sync: SyncChannel,
    targetShell: ShellChannel,
    sourcePath: string,
  ): Promise<WorkspaceSnapshot> {
    const state = await targetShell.call("workspace.open", { path: sourcePath });
    const snapshot = await sync.call("workspace.snapshot", undefined);
    if (!snapshot) throw new Error("workspace.open did not create a snapshot");
    expect(snapshot.workspaceId).toBe(state.workspaceId);
    return snapshot;
  }

  async function saveDocumentWithGlyphA(
    sync: SyncChannel,
    fileName: string,
  ): Promise<{ path: string; workspaceId: string }> {
    const { workspaceId } = await createWorkspace(sync);
    await sync.call("workspace.apply", { intents: [createGlyphA()], label: "Add Glyph" });
    const documentPath = path.join(tmpRoot, fileName);
    await sync.call("workspace.saveAs", { path: documentPath });
    return { path: documentPath, workspaceId };
  }

  async function addGlyphB(sync: SyncChannel): Promise<void> {
    await sync.call("workspace.apply", {
      intents: [createGlyph("B" as GlyphName, 66 as Unicode)],
      label: "Add Glyph",
    });
  }

  async function reopenedGlyphNames(documentPath: string): Promise<string[]> {
    const reopened = await startAdditionalHost();
    const snapshot = await openWorkspace(reopened.sync, reopened.shell, documentPath);
    return snapshot.glyphs.map((glyph) => glyph.name);
  }

  function canonicalGlyphNames(documentPath: string): string[] {
    const bridge = createBridge();
    const recoveryPath = path.join(tmpRoot, "inspection", `${crypto.randomUUID()}.sqlite`);

    fs.mkdirSync(path.dirname(recoveryPath), { recursive: true });
    try {
      bridge.openDocument(documentPath, recoveryPath);
      return bridge.getGlyphs().map((glyph) => glyph.name);
    } finally {
      bridge.closeWorkspace();
    }
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

  it("opens a retained source without allocating document or cache storage", async () => {
    const state = await shell.call("source.open", { path: retainedFontPath });
    const sync = await connectSyncLane();
    const snapshot = await sync.call("source.snapshot", undefined);

    expect(state.canonicalPath).toBe(fs.realpathSync(retainedFontPath));
    expect(snapshot?.font.metadata.familyName).toBeTruthy();
    expect(snapshot?.font.glyphs.length).toBeGreaterThan(0);
    expect(await sync.call("workspace.snapshot", undefined)).toBeNull();
    expect(await sync.call("document.state", undefined)).toBeNull();
    expect(fs.existsSync(path.join(tmpRoot, "workspaces"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, "atlas-cache"))).toBe(false);
  });

  it("reads selected retained glyph geometry without authored state", async () => {
    await shell.call("source.open", { path: retainedFontPath });
    const sync = await connectSyncLane();
    const snapshot = await sync.call("source.snapshot", undefined);
    if (!snapshot) throw new Error("source.open did not create a snapshot");
    const glyphId = snapshot.font.glyphs.find((glyph) => glyph.name === "A")?.id;
    if (!glyphId) throw new Error("fixture has no A glyph");

    const glyphs = await sync.call("source.glyph", { glyphId });
    const glyph = glyphs.find((candidate) => candidate.glyphId === glyphId);

    expect(glyph?.layers).toEqual([]);
    expect(glyph?.projection?.glyphId).toBe(glyphId);
    expect(glyph?.projection?.fallback.values.length).toBeGreaterThan(1);
    expect(await sync.call("workspace.snapshot", undefined)).toBeNull();
  });

  it("streams every retained atlas page and evaluates its resident weights", async () => {
    await shell.call("source.open", { path: retainedFontPath });
    const sync = await connectSyncLane();
    const snapshot = await sync.call("source.snapshot", undefined);
    if (!snapshot) throw new Error("source.open did not create a snapshot");
    const coordinates = snapshot.font.axes.map((axis) => axis.default);
    const pages = [];

    for (let start = 0, pageIndex = 0; start < snapshot.font.glyphs.length; start += 256) {
      const page = await sync.call("source.atlasPagePrepare", {
        pageIndex,
        glyphIds: snapshot.font.glyphs.slice(start, start + 256).map((glyph) => glyph.id),
        coordinates,
        alignment: 256,
      });
      const bytes = await streamSlugAtlas(sync, page.generation, 64, "source");
      expect(bytes.byteLength).toBe(page.layout.totalLength);
      pages.push(page);
      pageIndex += 1;
    }

    const weights = await sync.call("source.atlasWeights", { coordinates });
    const maximumCoordinates = snapshot.font.axes.map((axis) => axis.maximum ?? axis.default);
    const maximumWeights = await sync.call("source.atlasWeights", {
      coordinates: maximumCoordinates,
    });
    expect(weights.map((page) => page.pageIndex)).toEqual(pages.map((page) => page.pageIndex));
    expect(weights.map((page) => page.weights)).toEqual(pages.map((page) => page.weights));
    expect(maximumWeights).not.toEqual(weights);
    expect(fs.existsSync(path.join(tmpRoot, "workspaces"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, "atlas-cache"))).toBe(false);
  });

  it("drops retained catch-up state when the source closes", async () => {
    await shell.call("source.open", { path: retainedFontPath });
    const sync = await connectSyncLane();

    expect(await sync.call("source.snapshot", undefined)).not.toBeNull();
    expect(await shell.call("source.close", undefined)).toBeNull();
    expect(await sync.call("source.snapshot", undefined)).toBeNull();
  });

  it("creates a canonical document atomically from a foreign source", async () => {
    const documentPath = path.join(tmpRoot, "Converted.shift");

    const state = await shell.call("workspace.createFromSource", {
      sourcePath: convertibleFontPath,
      documentPath,
    });
    const sync = await connectSyncLane();
    const snapshot = await sync.call("workspace.snapshot", undefined);

    expect(state).toMatchObject({
      sourceKind: "document",
      documentId: expect.stringMatching(/^document_/),
      saveTarget: documentPath,
      canonicalPath: fs.realpathSync(documentPath),
      dirty: false,
      needsSaveAs: false,
    });
    expect(snapshot?.workspaceId).toBe(state.workspaceId);
    expect(snapshot?.glyphs.length).toBeGreaterThan(0);
    expect(canonicalGlyphNames(documentPath)).toEqual(
      expect.arrayContaining(snapshot?.glyphs.map((glyph) => glyph.name) ?? []),
    );
  });

  it("replaces an occupied destination during conversion", async () => {
    const occupiedPath = path.join(tmpRoot, "Occupied.shift");
    const previousDestination = Buffer.from("replace me");
    fs.writeFileSync(occupiedPath, previousDestination);

    const state = await shell.call("workspace.createFromSource", {
      sourcePath: convertibleFontPath,
      documentPath: occupiedPath,
    });

    expect(state).toMatchObject({ saveTarget: occupiedPath, needsSaveAs: false, dirty: false });
    expect(fs.readFileSync(occupiedPath)).not.toEqual(previousDestination);
    expect(canonicalGlyphNames(occupiedPath).length).toBeGreaterThan(0);
  });

  it("returns to closed after conversion publication fails", async () => {
    const blockedParent = path.join(tmpRoot, "not-a-directory");
    fs.writeFileSync(blockedParent, "blocked");

    await expect(
      shell.call("workspace.createFromSource", {
        sourcePath: convertibleFontPath,
        documentPath: path.join(blockedParent, "Converted.shift"),
      }),
    ).rejects.toThrow();

    await expect(shell.call("document.state", undefined)).resolves.toBeNull();
    const workspacesRoot = path.join(tmpRoot, "workspaces");
    expect(fs.existsSync(workspacesRoot) ? fs.readdirSync(workspacesRoot) : []).toEqual([]);

    const retryPath = path.join(tmpRoot, "Retried.shift");
    await expect(
      shell.call("workspace.createFromSource", {
        sourcePath: convertibleFontPath,
        documentPath: retryPath,
      }),
    ).resolves.toMatchObject({ saveTarget: retryPath, needsSaveAs: false });
  });

  it("streams one authored Slug generation through bounded native chunks", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    const glyph = createGlyphALayer(snapshot.sources[0]!.id);
    await applyWorkspace(sync, { intents: glyph.intents });

    const atlas = await sync.call("workspace.slugAtlasPrepare", { alignment: 256 });
    const bytes = await streamSlugAtlas(sync, atlas.generation, 64);

    expect(bytes.byteLength).toBe(atlas.layout.totalLength);
    expect(atlas.layout.glyphs.length).toBe(32);
    expect(atlas.glyphs.map((entry) => entry.glyphId)).toEqual([glyph.glyphId]);
  });

  it("streams requested roots through one validated cached artifact", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    const first = createGlyphALayer(snapshot.sources[0]!.id);
    const secondGlyphId = mintGlyphId();
    const secondLayerId = mintLayerId();
    await applyWorkspace(sync, {
      intents: [
        ...first.intents,
        createGlyph("B" as GlyphName, 66 as Unicode, secondGlyphId),
        createGlyphLayer(secondGlyphId, snapshot.sources[0]!.id, secondLayerId),
      ],
    });

    const request = {
      glyphIds: [secondGlyphId],
      alignment: 256,
      pageIndex: 0,
      pageCount: 1,
      replacementPageIndices: [0],
    };
    const page = await sync.call("workspace.slugAtlasPagePrepare", request);
    const bytes = await streamSlugAtlas(sync, page.generation, 64, page.origin);
    const cached = await sync.call("workspace.slugAtlasPagePrepare", request);
    const cachedBytes = await streamSlugAtlas(sync, cached.generation, 64, cached.origin);
    corruptAtlasCacheIndex();
    const retained = await sync.call("workspace.slugAtlasPagePrepare", request);
    const retainedBytes = await streamSlugAtlas(sync, retained.generation, 64, retained.origin);

    expect(page.origin).toBe("native");
    expect(cached.origin).toBe("cached");
    expect(retained.origin).toBe("cached");
    expect(cachedBytes).toEqual(bytes);
    expect(retainedBytes).toEqual(bytes);
    expect(cached.glyphs.map((entry) => entry.glyphId)).toEqual([secondGlyphId]);

    await applyWorkspace(sync, {
      intents: [{ kind: "setXAdvance", setXAdvance: { layerId: secondLayerId, width: 700 } }],
    });
    const changed = await sync.call("workspace.slugAtlasPagePrepare", request);
    expect(changed.origin).toBe("native");
    await sync.call("workspace.slugAtlasPageDiscard", {
      generation: changed.generation,
      origin: changed.origin,
    });
    await shell.call("workspace.close", { discard: true });
  });

  it("reuses saved document atlas bytes after a fresh workspace allocation", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    const glyph = createGlyphALayer(snapshot.sources[0]!.id);
    await applyWorkspace(sync, { intents: glyph.intents });
    const documentPath = path.join(tmpRoot, "Cached.shift");
    const saved = await sync.call("workspace.saveAs", { path: documentPath });
    const request = {
      glyphIds: [glyph.glyphId],
      alignment: 256,
      pageIndex: 0,
      pageCount: 1,
      replacementPageIndices: [0],
    };
    const page = await sync.call("workspace.slugAtlasPagePrepare", request);
    const bytes = await streamSlugAtlas(sync, page.generation, 64, page.origin);

    await shell.call("workspace.close", { discard: false });
    const reopened = await shell.call("workspace.open", { path: documentPath });
    const cached = await sync.call("workspace.slugAtlasPagePrepare", request);
    const cachedBytes = await streamSlugAtlas(sync, cached.generation, 64, cached.origin);

    expect(page.origin).toBe("native");
    expect(reopened.workspaceId).not.toBe(saved.workspaceId);
    expect(reopened.documentId).toBe(saved.documentId);
    expect(cached.origin).toBe("cached");
    expect(cachedBytes).toEqual(bytes);

    await applyWorkspace(sync, {
      intents: [{ kind: "setXAdvance", setXAdvance: { layerId: glyph.layerId, width: 700 } }],
    });
    const changed = await sync.call("workspace.slugAtlasPagePrepare", request);
    expect(changed.origin).toBe("native");
    await sync.call("workspace.slugAtlasPageDiscard", {
      generation: changed.generation,
      origin: changed.origin,
    });
    await shell.call("workspace.close", { discard: true });
  });

  it("keeps unbound atlas artifacts isolated by workspace allocation", async () => {
    const sync = await connectSyncLane();
    const glyphId = mintGlyphId();
    const layerId = mintLayerId();
    const first = await createWorkspace(sync);
    await applyWorkspace(sync, {
      intents: [createGlyphA(glyphId), createGlyphLayer(glyphId, first.sources[0]!.id, layerId)],
    });
    const request = {
      glyphIds: [glyphId],
      alignment: 256,
      pageIndex: 0,
      pageCount: 1,
      replacementPageIndices: [0],
    };
    const page = await sync.call("workspace.slugAtlasPagePrepare", request);
    await streamSlugAtlas(sync, page.generation, 64, page.origin);
    await shell.call("workspace.close", { discard: true });

    const second = await createWorkspace(sync);
    await applyWorkspace(sync, {
      intents: [createGlyphA(glyphId), createGlyphLayer(glyphId, second.sources[0]!.id, layerId)],
    });
    const isolated = await sync.call("workspace.slugAtlasPagePrepare", request);

    expect(second.workspaceId).not.toBe(first.workspaceId);
    expect(page.origin).toBe("native");
    expect(isolated.origin).toBe("native");
    await sync.call("workspace.slugAtlasPageDiscard", {
      generation: isolated.generation,
      origin: isolated.origin,
    });
    await shell.call("workspace.close", { discard: true });
  });

  it("publishes cached pages after retrying one page before the build completes", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    const first = createGlyphALayer(snapshot.sources[0]!.id);
    const secondGlyphId = mintGlyphId();
    const secondLayerId = mintLayerId();
    await applyWorkspace(sync, {
      intents: [
        ...first.intents,
        createGlyph("B" as GlyphName, 66 as Unicode, secondGlyphId),
        createGlyphLayer(secondGlyphId, snapshot.sources[0]!.id, secondLayerId),
      ],
    });

    const firstRequest = {
      glyphIds: [first.glyphId],
      alignment: 256,
      pageIndex: 0,
      pageCount: 2,
      replacementPageIndices: [0, 1],
    };
    const secondRequest = {
      ...firstRequest,
      glyphIds: [secondGlyphId],
      pageIndex: 1,
    };
    const firstPage = await sync.call("workspace.slugAtlasPagePrepare", firstRequest);
    await streamSlugAtlas(sync, firstPage.generation, 64, firstPage.origin);
    const retriedPage = await sync.call("workspace.slugAtlasPagePrepare", firstRequest);
    const retriedBytes = await streamSlugAtlas(
      sync,
      retriedPage.generation,
      64,
      retriedPage.origin,
    );
    const secondPage = await sync.call("workspace.slugAtlasPagePrepare", secondRequest);
    await streamSlugAtlas(sync, secondPage.generation, 64, secondPage.origin);
    const cachedPage = await sync.call("workspace.slugAtlasPagePrepare", firstRequest);
    const cachedBytes = await streamSlugAtlas(sync, cachedPage.generation, 64, cachedPage.origin);

    expect(firstPage.origin).toBe("native");
    expect(retriedPage.origin).toBe("native");
    expect(secondPage.origin).toBe("native");
    expect(cachedPage.origin).toBe("cached");
    expect(cachedBytes).toEqual(retriedBytes);

    await shell.call("workspace.close", { discard: true });
  });

  it("cancels native Slug production when the renderer rejects a chunk", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    await applyWorkspace(sync, {
      intents: createGlyphALayer(snapshot.sources[0]!.id).intents,
    });
    const atlas = await sync.call("workspace.slugAtlasPrepare", { alignment: 256 });
    const lane = new MessageChannel();
    lane.port2.onmessage = (event: MessageEvent<ByteStreamMessage>) => {
      if (event.data.kind !== "chunk") return;
      lane.port2.postMessage({ kind: "cancel", message: "GPU upload rejected" });
    };
    lane.port2.start();

    await expect(
      sync.call("workspace.slugAtlasStream", { generation: atlas.generation, maximumLength: 64 }, [
        lane.port1,
      ]),
    ).rejects.toThrow("GPU upload rejected");
    lane.port2.close();

    await expect(
      sync.call("workspace.slugAtlasPrepare", { alignment: 256 }),
    ).resolves.toMatchObject({ generation: atlas.generation + 1 });
  });

  it("invalidates a prepared Slug generation after an authored edit", async () => {
    const sync = await connectSyncLane();
    await createWorkspace(sync);
    const stale = await sync.call("workspace.slugAtlasPrepare", { alignment: 256 });
    const glyphId = mintGlyphId();
    await applyWorkspace(sync, { intents: [createGlyphA(glyphId)] });
    const rejectedLane = new MessageChannel();
    rejectedLane.port2.onmessage = () => undefined;

    await expect(
      sync.call("workspace.slugAtlasStream", { generation: stale.generation, maximumLength: 64 }, [
        rejectedLane.port1,
      ]),
    ).rejects.toThrow(`unknown Slug atlas generation ${stale.generation}`);
    rejectedLane.port2.close();

    const current = await sync.call("workspace.slugAtlasPrepare", { alignment: 256 });
    await expect(streamSlugAtlas(sync, current.generation, 64)).resolves.toHaveLength(
      current.layout.totalLength,
    );
    expect(current.glyphs.map((entry) => entry.glyphId)).toEqual([glyphId]);
  });

  it("emits ready after start", async () => {
    const lane = new MessageChannel();
    const client: ShellChannel = new Channel(nodePortTransport(lane.port1));
    channels.push(client);
    const ready = new Promise<void>((resolve) => client.listen("ready", resolve));

    startHost(nodePortTransport(lane.port2));

    await expect(ready).resolves.toBeUndefined();
  });

  it("retains existing documents across host restarts", async () => {
    // An authored draft must never die with the process: the data-loss
    // class the durability ADRs were written against.
    const sync = await connectSyncLane();
    const { workspaceId } = await createWorkspace(sync);
    const storePath = path.join(tmpRoot, "workspaces", workspaceId, "document.sqlite");
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

  it("creates an untitled workspace from the shell lane", async () => {
    const state = await shell.call("workspace.create", undefined);

    expect(state).toMatchObject({
      sourceKind: "untitled",
      saveTarget: null,
      dirty: false,
      needsSaveAs: true,
    });

    const sync = await connectSyncLane();
    await expect(sync.call("workspace.snapshot", undefined)).resolves.toMatchObject({
      workspaceId: state.workspaceId,
      glyphs: [],
    });
  });

  it("creates an untitled workspace and returns it as the next state", async () => {
    const sync = await connectSyncLane();

    const snapshot = await createWorkspace(sync);

    expect(snapshot.workspaceId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    expect(snapshot.glyphs).toEqual([]);
    expect(snapshot.metrics.unitsPerEm).toBe(1000);
    expect(snapshot.sources.length).toBeGreaterThan(0);
    expect(snapshot.axes).toEqual([]);
  });

  it("writes the SQLite store under the workspace root", async () => {
    const sync = await connectSyncLane();

    const { workspaceId } = await createWorkspace(sync);

    const storePath = path.join(tmpRoot, "workspaces", workspaceId, "document.sqlite");
    expect(fs.existsSync(storePath)).toBe(true);
  });

  it("workspace.snapshot returns the created workspace", async () => {
    const sync = await connectSyncLane();
    const created = await createWorkspace(sync);

    await expect(sync.call("workspace.snapshot", undefined)).resolves.toEqual(created);
  });

  it("opens a canonical document through a sparse recovery workspace", async () => {
    const source = await connectSyncLane();
    const saved = await saveDocumentWithGlyphA(source, "OpenMe.shift");
    const restarted = await startAdditionalHost();

    const state = await restarted.shell.call("workspace.open", { path: saved.path });
    const snapshot = await restarted.sync.call("workspace.snapshot", undefined);

    expect(state).toMatchObject({
      sourceKind: "document",
      documentId: expect.stringMatching(/^document_/),
      canonicalPath: fs.realpathSync(saved.path),
      dirty: false,
      needsSaveAs: false,
    });
    expect(snapshot?.glyphs.map((glyph) => glyph.name)).toEqual(["A"]);
  });

  it("recovers unsaved edits on the next document open", async () => {
    const source = await connectSyncLane();
    const saved = await saveDocumentWithGlyphA(source, "RecoverMe.shift");
    await addGlyphB(source);
    expect(canonicalGlyphNames(saved.path)).toEqual(["A"]);

    const restarted = await startAdditionalHost();
    const opened = await openWorkspace(restarted.sync, restarted.shell, saved.path);

    expect(opened.workspaceId).toBe(saved.workspaceId);
    expect(opened.glyphs.map((glyph) => glyph.name)).toEqual(["A", "B"]);
    await expect(restarted.shell.call("document.state", undefined)).resolves.toMatchObject({
      sourceKind: "document",
      dirty: true,
    });
    await restarted.sync.call("workspace.save", undefined);
    expect(canonicalGlyphNames(saved.path)).toEqual(["A", "B"]);
  });

  it("prunes orphan storage before recovery discovery", async () => {
    const orphanPath = path.join(tmpRoot, "workspaces", "orphan");
    fs.mkdirSync(orphanPath, { recursive: true });
    fs.writeFileSync(path.join(orphanPath, "recovery.sqlite-wal"), "orphan");
    const restarted = await startAdditionalHost();

    await restarted.shell.call("workspace.listRecoveries", undefined);

    expect(fs.existsSync(orphanPath)).toBe(false);
  });

  it("lists recoveries and resumes an unsaved working database", async () => {
    const sync = await connectSyncLane();
    const created = await createWorkspace(sync);
    await addGlyphB(sync);

    const restarted = await startAdditionalHost();
    await expect(restarted.shell.call("workspace.listRecoveries", undefined)).resolves.toEqual([
      { kind: "unsaved", state: "recoverable", workspaceId: created.workspaceId },
    ]);

    const state = await restarted.shell.call("workspace.resume", {
      workspaceId: created.workspaceId,
    });
    const snapshot = await restarted.sync.call("workspace.snapshot", undefined);

    expect(state).toMatchObject({
      workspaceId: created.workspaceId,
      sourceKind: "untitled",
      dirty: true,
      needsSaveAs: true,
    });
    expect(snapshot?.glyphs.map((glyph) => glyph.name)).toEqual(["B"]);
  });

  it("discard removes recovered edits without changing the canonical document", async () => {
    const source = await connectSyncLane();
    const saved = await saveDocumentWithGlyphA(source, "DiscardMe.shift");
    await addGlyphB(source);
    const restarted = await startAdditionalHost();
    await openWorkspace(restarted.sync, restarted.shell, saved.path);

    await restarted.shell.call("workspace.close", { discard: true });
    const reopened = await startAdditionalHost();
    const snapshot = await openWorkspace(reopened.sync, reopened.shell, saved.path);

    expect(snapshot.glyphs.map((glyph) => glyph.name)).toEqual(["A"]);
    await expect(reopened.shell.call("document.state", undefined)).resolves.toMatchObject({
      dirty: false,
    });
  });

  it("Save As rebinds a recovered document without mutating its source", async () => {
    const source = await connectSyncLane();
    const saved = await saveDocumentWithGlyphA(source, "Source.shift");
    const sourceState = await shell.call("document.state", undefined);
    await addGlyphB(source);
    const destinationPath = path.join(tmpRoot, "Destination.shift");

    const rebound = await source.call("workspace.saveAs", { path: destinationPath });

    expect(rebound.documentId).not.toBe(sourceState?.documentId);
    expect(rebound.canonicalPath).toBe(fs.realpathSync(destinationPath));
    expect(canonicalGlyphNames(saved.path)).toEqual(["A"]);
    expect(canonicalGlyphNames(destinationPath)).toEqual(["A", "B"]);
    await expect(reopenedGlyphNames(saved.path)).resolves.toEqual(["A"]);
  });

  it("keeps the current binding when Save As cannot publish its destination", async () => {
    const sync = await connectSyncLane();
    const saved = await saveDocumentWithGlyphA(sync, "Bound.shift");
    await addGlyphB(sync);
    const before = await shell.call("document.state", undefined);
    const blockedParent = path.join(tmpRoot, "not-a-directory");
    fs.writeFileSync(blockedParent, "blocked");

    await expect(
      sync.call("workspace.saveAs", { path: path.join(blockedParent, "Saved.shift") }),
    ).rejects.toThrow();
    await expect(shell.call("document.state", undefined)).resolves.toEqual(before);
    const retryPath = path.join(tmpRoot, "Retried.shift");
    const retried = await sync.call("workspace.saveAs", { path: retryPath });
    expect(retried).toMatchObject({
      workspaceId: saved.workspaceId,
      canonicalPath: fs.realpathSync(retryPath),
    });
    expect(canonicalGlyphNames(saved.path)).toEqual(["A"]);
    expect(canonicalGlyphNames(retryPath)).toEqual(["A", "B"]);
  });

  it("emits utility-owned document state after create and apply", async () => {
    let latestState: WorkspaceDocumentState | null = null;
    const unlisten = shell.listen("document.changed", (state) => {
      latestState = state;
    });
    const sync = await connectSyncLane();

    const created = await createWorkspace(sync);
    await shell.call("document.state", undefined);
    expect(latestState).toMatchObject({
      workspaceId: created.workspaceId,
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

  it("workspace.close deletes a clean document and emits null state", async () => {
    let latestState: WorkspaceDocumentState | null | undefined;
    const unlisten = shell.listen("document.changed", (state) => {
      latestState = state;
    });
    const sync = await connectSyncLane();
    const created = await createWorkspace(sync);
    const storePath = path.join(tmpRoot, "workspaces", created.workspaceId, "document.sqlite");

    await expect(shell.call("workspace.close", { discard: false })).resolves.toBeNull();

    expect(latestState).toBeNull();
    expect(fs.existsSync(storePath)).toBe(false);
    await expect(shell.call("document.state", undefined)).resolves.toBeNull();
    await expect(sync.call("workspace.snapshot", undefined)).resolves.toBeNull();
    unlisten();
  });

  it("workspace.close requires discard for dirty documents", async () => {
    const sync = await connectSyncLane();
    const created = await createWorkspace(sync);
    await sync.call("workspace.apply", { intents: [createGlyphA()], label: "Add Glyph" });
    const storePath = path.join(tmpRoot, "workspaces", created.workspaceId, "document.sqlite");

    await expect(shell.call("workspace.close", { discard: false })).rejects.toThrow(
      "cannot close a dirty workspace without discard",
    );
    await expect(shell.call("document.state", undefined)).resolves.toMatchObject({
      workspaceId: created.workspaceId,
      dirty: true,
    });

    await expect(shell.call("workspace.close", { discard: true })).resolves.toBeNull();
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it("a reconnected sync lane still serves the open workspace", async () => {
    const first = await connectSyncLane();
    const created = await createWorkspace(first);

    const second = await connectSyncLane();

    await expect(second.call("workspace.snapshot", undefined)).resolves.toEqual(created);
  });

  it("apply createGlyph echoes identity records without layers", async () => {
    const sync = await connectSyncLane();
    await createWorkspace(sync);

    const applied = await applyWorkspace(sync, {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });

    expect(applied.next?.glyphs?.map((glyph) => glyph.name)).toEqual(["A"]);
    expect(applied.next?.glyphs?.[0]?.layers).toEqual([]);
    expect(applied.layers).toEqual([]);

    const snapshot = await sync.call("workspace.snapshot", undefined);
    expect(snapshot?.glyphs.map((glyph) => glyph.name)).toEqual(["A"]);
    expect(snapshot?.glyphs[0]?.layers).toEqual([]);
  });

  it("apply createGlyphLayer echoes sparse membership and a structural layer", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);

    const applied = await applyWorkspace(sync, {
      intents,
      label: "Add Glyph Layer",
    });

    expect(applied.next?.glyphs?.[0]?.layers).toEqual([
      { id: layerId, sourceId: snapshot.sources[0].id },
    ]);
    expect(applied.layers).toHaveLength(1);
    expect(applied.layers[0].layerId).toBe(layerId);
    expect(applied.layers[0].structure).toBeDefined();
  });

  it("workspace.save reports NeedsSaveAs for untitled workspaces", async () => {
    const sync = await connectSyncLane();
    await createWorkspace(sync);
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

  it("workspace.saveAs writes a native document and clears dirty for later saves", async () => {
    const sync = await connectSyncLane();
    await createWorkspace(sync);
    await applyWorkspace(sync, {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });

    const savePath = path.join(tmpRoot, "SavedFont.shift");
    const saved = await sync.call("workspace.saveAs", { path: savePath });

    expect(saved).toMatchObject({
      sourceKind: "document",
      documentId: expect.stringMatching(/^document_/),
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
    await createWorkspace(sync);
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
    await createWorkspace(sync);

    const created = await applyWorkspace(sync, {
      intents: [createGlyphA()],
      label: "Add Glyph",
    });
    const glyphId = created.next?.glyphs?.[0].id;
    if (!glyphId) throw new Error("createGlyph must echo the record id");

    const undone = await undoWorkspace(sync);
    expect(undone?.next?.glyphs?.map((glyph) => glyph.name)).toEqual([]);
    expect(undone?.layers).toEqual([]);
    await expect(sync.call("workspace.snapshot", undefined)).resolves.toMatchObject({
      glyphs: [],
    });

    const redone = await redoWorkspace(sync);
    expect(redone?.next?.glyphs?.map((glyph) => glyph.name)).toEqual(["A"]);
    expect(redone?.next?.glyphs?.[0]?.layers).toEqual([]);
    expect(redone?.layers).toEqual([]);
    await expect(sync.call("workspace.snapshot", undefined)).resolves.toMatchObject({
      glyphs: [{ id: glyphId, name: "A", layers: [] }],
    });
  });

  it("apply setXAdvance echoes values without structure or records", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);
    const created = await applyWorkspace(sync, {
      intents,
    });
    expect(created.layers[0].layerId).toBe(layerId);

    const applied = await applyWorkspace(sync, {
      intents: [{ kind: "setXAdvance", setXAdvance: { layerId, width: 642 } }],
    });

    expect(applied.next).toBeUndefined();
    expect(applied.layers[0].layerId).toBe(layerId);
    expect(applied.layers[0].structure).toBeUndefined();
    expect(applied.layers[0].values[0]).toBe(642);
  });

  it("apply rejects unknown intent kinds with a channel error", async () => {
    const sync = await connectSyncLane();
    await createWorkspace(sync);

    await expect(applyWorkspace(sync, { intents: [{ kind: "explodeFont" }] })).rejects.toThrow(
      "explodeFont",
    );
  });

  it("pen intents apply atomically with client-minted ids through the channel", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
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
    expect(applied.next).toBeUndefined();
    expect(applied.dependents).toEqual([]);
  });

  it("undo and redo replay ledger entries through the channel", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
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
    await createWorkspace(sync);

    await expect(undoWorkspace(sync)).resolves.toBeNull();
    await expect(redoWorkspace(sync)).resolves.toBeNull();
  });

  it("workspace.glyphSnapshots pulls bounded source snapshots by stable glyph id", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
    const { layerId, intents } = createGlyphALayer(snapshot.sources[0].id);
    const created = await applyWorkspace(sync, {
      intents,
    });
    expect(created.next?.glyphs?.[0]?.layers).toEqual([
      { id: layerId, sourceId: snapshot.sources[0].id },
    ]);

    const glyphId = created.next?.glyphs?.[0]?.id;
    if (!glyphId) throw new Error("createGlyph did not echo glyph id");

    const snapshots = await sync.call("workspace.glyphSnapshots", {
      requests: [{ glyphId }],
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].glyphId).toBe(glyphId);
    expect(snapshots[0].layers).toHaveLength(1);
    expect(snapshots[0].layers[0].state.layerId).toBe(layerId);
    expect(snapshots[0].layers[0].state.structure.contours).toEqual([]);

    const missing = mintGlyphId();
    await expect(
      sync.call("workspace.glyphSnapshots", {
        requests: [{ glyphId: missing }],
      }),
    ).resolves.toEqual([]);
  });

  it("CS0 skeleton: measures the apply round trip through the full stack", async () => {
    const sync = await connectSyncLane();
    const snapshot = await createWorkspace(sync);
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
