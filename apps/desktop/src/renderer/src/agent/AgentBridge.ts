import type {
  EditorView,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerView,
} from "@shift/runtime";
import type { GlyphId, GlyphState, SourceId } from "@shift/types";
import { GlyphGeometry } from "@shift/glyph-state";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AgentCallMap, AgentEventMap } from "@shared/agent/protocol";
import { domPortTransport, serveChannel, type ChannelServer } from "@shared/workspace/channel";
import type { FontSession } from "@/types/fontSession";

/** Serves bounded editor observations for one live renderer window. */
export class AgentBridge {
  readonly #host: ShiftHost;
  readonly #session: FontSession;
  #requests: ChannelServer<AgentEventMap> | null = null;
  #disposed = false;

  constructor(host: ShiftHost, session: FontSession) {
    this.#host = host;
    this.#session = session;
  }

  /** Connects the renderer lane requested by Electron main. */
  async connect(): Promise<void> {
    const port = nextAgentPort();

    try {
      await this.#host.agent.connect();
      const received = await port.received;
      if (this.#disposed) {
        received.close();
        return;
      }

      this.#requests?.dispose();
      this.#requests = serveChannel<AgentCallMap, AgentEventMap>(domPortTransport(received), {
        "editor.inspect": () => this.#inspectEditor(),
        "font.get": () => this.#getFont(),
        "glyphs.list": (input) => this.#listGlyphs(input),
        "glyphs.get": (selector) => this.#getGlyph(selector),
        "layers.get": ({ glyphId, sourceId }) => this.#getLayer(glyphId, sourceId),
      });
    } catch (error) {
      port.cancel();
      throw error;
    }
  }

  /** Disconnects the request lane and prevents a pending connection from publishing. */
  dispose(): void {
    this.#disposed = true;
    this.#requests?.dispose();
    this.#requests = null;
  }

  #getFont(): FontOverview {
    const font = this.#session.font;
    return {
      mode: this.#session.mode,
      metadata: font.metadata,
      metrics: font.metrics,
      glyphCount: font.glyphEntries().length,
      axes: font.getAxes(),
      sources: font.sources,
      namedInstances: font.namedInstances,
    };
  }

  async #listGlyphs({
    limit = 25,
    cursor,
    sourceId,
  }: {
    limit?: number;
    cursor?: string;
    sourceId?: SourceId;
  }): Promise<GlyphPage> {
    if (sourceId) this.#requireAuthoredSource(sourceId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("glyphs.list limit must be between 1 and 100");
    }

    const font = this.#session.font;
    const entries = font.glyphEntries();
    let start = 0;
    if (cursor) {
      let previousId: string;
      try {
        previousId = atob(cursor);
      } catch {
        throw new Error("Invalid glyph cursor");
      }

      const previousIndex = entries.findIndex(({ id }) => id === previousId);
      if (previousIndex < 0) throw new Error("Glyph cursor is no longer in this font");
      start = previousIndex + 1;
    }

    const page = entries.slice(start, start + limit);
    const items = page.map((entry) => glyphSummary(this.#session, entry.id));
    if (sourceId) {
      const requested = items.filter((item) => item.sourceIds.includes(sourceId));
      if (this.#session.workspace) {
        const snapshots = await this.#session.workspace.editCoordinator.readGlyphSnapshots(
          requested.map(({ id }) => ({ glyphId: id })),
        );
        const byId = new Map(snapshots.map((snapshot) => [snapshot.glyphId, snapshot]));
        for (const item of items) {
          if (!item.sourceIds.includes(sourceId)) {
            item.structure = null;
            continue;
          }
          const structure = byId.get(item.id)?.layers.find((layer) => layer.sourceId === sourceId)
            ?.state.structure;
          if (!structure) throw new Error(`Authored layer for glyph ${item.id} was not returned`);
          item.structure = structure;
        }
      } else {
        const glyphs = await font.loadGlyphs(requested.map(({ id }) => id));
        const byId = new Map(glyphs.map((glyph) => [glyph.id, glyph]));
        for (const item of items) {
          item.structure = byId.get(item.id)?.layerForSource(sourceId)?.state.structure ?? null;
        }
      }
    }

    const last = page.at(-1);
    return {
      items,
      nextCursor: start + page.length < entries.length && last ? btoa(last.id) : null,
    };
  }

  #getGlyph(selector: GlyphSelector): GlyphSummary {
    const font = this.#session.font;
    const entry =
      selector.name !== undefined
        ? font.entryForName(selector.name)
        : font.entryForId(selector.glyphId);
    if (!entry) throw new Error(`Glyph ${selector.name ?? selector.glyphId} is not in this font`);
    return glyphSummary(this.#session, entry.id);
  }

  async #getLayer(glyphId: GlyphId, sourceId: SourceId): Promise<LayerView | null> {
    this.#requireAuthoredSource(sourceId);
    const font = this.#session.font;
    const entry = font.entryForId(glyphId);
    if (!entry) throw new Error(`Glyph ${glyphId} is not in this font`);
    if (!font.recordForId(glyphId)?.layers.some((layer) => layer.sourceId === sourceId)) {
      return null;
    }

    let state: GlyphState;
    if (this.#session.workspace) {
      const snapshots = await this.#session.workspace.editCoordinator.readGlyphSnapshots([
        { glyphId },
      ]);
      const layer = snapshots[0]?.layers.find((layer) => layer.sourceId === sourceId);
      if (!layer) throw new Error(`Authored layer for glyph ${glyphId} was not returned`);
      state = layer.state;
    } else {
      const glyph = await font.loadGlyph(glyphId);
      const layer = glyph.layerForSource(sourceId);
      if (!layer) throw new Error(`Authored layer for glyph ${glyphId} was not returned`);
      state = layer.state;
    }
    const geometry = GlyphGeometry.fromState(state);

    return {
      glyphId,
      sourceId,
      layerId: state.layerId,
      structure: state.structure,
      xAdvance: geometry.xAdvance,
      bounds: geometry.bounds,
      anchors: geometry.anchors.map(({ id, name, x, y }) => ({ id, name: name ?? null, x, y })),
      points: geometry.allPoints.map(({ id, x, y, pointType, smooth }) => ({
        id,
        x,
        y,
        pointType,
        smooth,
      })),
    };
  }

  #requireAuthoredSource(sourceId: SourceId): void {
    if (this.#session.mode === "preview") {
      throw new Error("Authored layers are unavailable in preview sessions");
    }
    const font = this.#session.font;
    if (
      !font.sources.some(({ id }) => id === sourceId) &&
      !font
        .glyphEntries()
        .some(({ id }) => font.recordForId(id)?.layers.some((layer) => layer.sourceId === sourceId))
    ) {
      throw new Error(`Source ${sourceId} is not in this font`);
    }
  }

  #inspectEditor(): EditorView {
    const editor = this.#session.editor;
    const node = editor.scene.nodesOfKind("glyph")[0] ?? null;
    const record = node ? this.#session.font.recordForId(node.glyphId) : null;
    const glyph =
      node && record
        ? {
            glyphId: node.glyphId,
            name: record.name,
            nodeId: node.id,
            sourceId: node.sourceId,
          }
        : null;
    const tool = editor.tool;

    return {
      route: window.location.hash.slice(1),
      glyph,
      activeSourceId: editor.activeSourceId,
      editingSourceIds: [...editor.editingSourceIds],
      externalLocation: [...editor.externalLocation].map(([axisId, value]) => ({ axisId, value })),
      selectionIds: [...editor.selection.ids],
      tool: tool ? { id: tool.id, state: tool.state.type } : null,
      dragging: editor.isDragging,
      editing: editor.isEditing,
      applyStatus: this.#session.workspace?.applyStatusCell.peek() ?? null,
    };
  }
}

function glyphSummary(session: FontSession, glyphId: GlyphId): GlyphSummary {
  const entry = session.font.entryForId(glyphId);
  if (!entry) throw new Error(`Glyph ${glyphId} is not in this font`);

  return {
    id: entry.id,
    name: entry.name,
    unicodes: [...entry.unicodes],
    componentBaseGlyphIds: session.font.recordForId(glyphId)?.componentBaseGlyphIds ?? [],
    sourceIds: session.font.recordForId(glyphId)?.layers.map(({ sourceId }) => sourceId) ?? [],
  };
}

function nextAgentPort(): { received: Promise<MessagePort>; cancel: () => void } {
  let cancel = () => {};
  const received = new Promise<MessagePort>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if ((event.data as { type?: string } | null)?.type !== "agent.port") return;

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
