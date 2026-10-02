import type { EditorView } from "@shift/runtime";
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
