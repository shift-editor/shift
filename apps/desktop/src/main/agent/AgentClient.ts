import type {
  EditorView,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  LayerView,
} from "@shift/runtime";
import type { GlyphId, SourceId } from "@shift/types";
import type { MessagePortMain } from "electron";
import type { AgentCallMap, AgentEventMap, EditorCaptureBounds } from "../../shared/agent/protocol";
import { Channel, electronPortTransport } from "../../shared/workspace/channel";
import { createShiftLogger, type ShiftLogger } from "../logging";

/** Calls the agent inspection lane served by one renderer window. */
export class AgentClient {
  readonly #log: ShiftLogger;
  #channel: Channel<AgentCallMap, AgentEventMap> | null = null;

  constructor(log: ShiftLogger = createShiftLogger("agent.client")) {
    this.#log = log;
  }

  get connected(): boolean {
    return this.#channel !== null && !this.#channel.closed;
  }

  /** Replaces the inspection lane after a renderer connects or reloads. */
  connect(port: MessagePortMain): void {
    this.#channel?.dispose();
    this.#channel = new Channel<AgentCallMap, AgentEventMap>(electronPortTransport(port));
    this.#log.info("agent renderer connected");
  }

  /** Returns the visible editor rectangle in renderer CSS pixels. */
  editorCaptureBounds(): Promise<EditorCaptureBounds> {
    return this.#call("capture.editorBounds", undefined);
  }

  /** Returns a point-in-time view of the editor owned by this renderer. */
  inspectEditor(): Promise<EditorView> {
    if (!this.#channel) return Promise.reject(new Error("agent renderer is not connected"));
    return this.#channel.call("editor.inspect", undefined);
  }

  getFont(): Promise<FontOverview> {
    return this.#call("font.get", undefined);
  }

  listGlyphs(input: { limit?: number; cursor?: string; sourceId?: SourceId }): Promise<GlyphPage> {
    return this.#call("glyphs.list", input);
  }

  getGlyph(selector: GlyphSelector): Promise<GlyphSummary> {
    return this.#call("glyphs.get", selector);
  }

  getLayer(glyphId: GlyphId, sourceId: SourceId): Promise<LayerView | null> {
    return this.#call("layers.get", { glyphId, sourceId });
  }

  renderLayer(
    glyphId: GlyphId,
    sourceId: SourceId,
    overlays?: LayerOverlays,
    appearance?: LayerAppearance,
  ): Promise<LayerSvg | null> {
    return this.#call("layers.render", { glyphId, sourceId, overlays, appearance });
  }

  #call<K extends keyof AgentCallMap>(
    operation: K,
    input: AgentCallMap[K]["request"],
  ): Promise<AgentCallMap[K]["response"]> {
    if (!this.#channel) return Promise.reject(new Error("agent renderer is not connected"));
    return this.#channel.call(operation, input);
  }

  /** Disconnects the renderer and rejects pending inspection calls. */
  dispose(): void {
    this.#channel?.dispose();
    this.#channel = null;
  }
}
