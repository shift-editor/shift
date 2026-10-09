import type { EditorView, FontRevision, ShiftObservation } from "@shift/runtime";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AgentCallMap, AgentEventMap } from "@shared/agent/protocol";
import { domPortTransport, serveChannel, type ChannelServer } from "@shared/workspace/channel";
import type { FontSession } from "@/types/fontSession";
import { ShiftFontReader } from "./ShiftFontReader";

/** Serves bounded editor observations for one live renderer window. */
export class AgentBridge {
  readonly #host: ShiftHost;
  readonly #session: FontSession;
  readonly #reader: ShiftFontReader;
  readonly #revisionNamespace = crypto.randomUUID();
  #requests: ChannelServer<AgentEventMap> | null = null;
  #disposed = false;

  constructor(host: ShiftHost, session: FontSession) {
    this.#host = host;
    this.#session = session;
    this.#reader = new ShiftFontReader(session.font, session.mode);
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
        "capture.editorBounds": () => this.#editorCaptureBounds(),
        "font.revision": ({ ifFontRevision }) => this.#readRevision(ifFontRevision),
        "editor.inspect": ({ ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#inspectEditor()),
        "font.get": ({ ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getFont()),
        "locations.resolve": ({ location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.resolveLocation(location)),
        "glyphs.list": ({ limit, cursor, sourceId, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.listGlyphs({ limit, cursor, sourceId })),
        "glyphs.get": ({ selector, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getGlyph(selector)),
        "glyphs.resolve": ({ glyphIds, location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.resolveGlyphs(glyphIds, location)),
        "layers.get": ({ layerId, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.getLayer(layerId)),
        "layers.resolve": ({ layerId, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#reader.resolveLayer(layerId)),
        "layers.render": ({ layerId, overlays, appearance, ifFontRevision }) =>
          this.#observe(ifFontRevision, () =>
            this.#reader.renderLayer(layerId, { overlays, appearance }),
          ),
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

  async #readRevision(ifFontRevision: FontRevision | undefined): Promise<FontRevision> {
    const observation = await this.#observe(ifFontRevision, () => null);
    return observation.fontRevision;
  }

  async #observe<Value>(
    ifFontRevision: FontRevision | undefined,
    read: () => Value | Promise<Value>,
  ): Promise<ShiftObservation<Value>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.#session.workspace?.editCoordinator.settled();
      const before = this.#fontRevision();
      this.#assertRevision(ifFontRevision, before);

      const value = await read();
      await this.#session.workspace?.editCoordinator.settled();
      const after = this.#fontRevision();
      if (before === after) return { fontRevision: before, value };
      if (ifFontRevision) this.#assertRevision(ifFontRevision, after);
    }

    throw new Error("The font changed while Shift was reading it; retry the observation");
  }

  #fontRevision(): FontRevision {
    const sequence = this.#session.workspace?.editCoordinator.authoredRevisionCell.peek() ?? 0;
    return `${this.#revisionNamespace}:${sequence}`;
  }

  #assertRevision(expected: FontRevision | undefined, current: FontRevision): void {
    if (!expected || expected === current) return;
    throw new Error(`Font revision mismatch: expected ${expected}, current ${current}`);
  }

  #editorCaptureBounds() {
    const element = document.querySelector<HTMLElement>("[data-shift-capture-target='editor']");
    if (!element) throw new Error("This Shift window has no visible editor");

    const { x, y, width, height } = element.getBoundingClientRect();
    if (width <= 0 || height <= 0) throw new Error("The Shift editor is not visible");
    return { x, y, width, height };
  }

  #inspectEditor(): EditorView {
    const editor = this.#session.editor;
    const node = editor.scene.nodesOfKind("glyph")[0] ?? null;
    const entry = node ? this.#session.font.entryForId(node.glyphId) : null;
    const glyph =
      node && entry
        ? {
            glyphId: node.glyphId,
            name: entry.name,
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
