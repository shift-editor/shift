import type {
  AuthoredLayer,
  AxisCoordinate,
  EditorView,
  FontOverview,
  FontRevision,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  ResolvedGlyphs,
  ResolvedLocation,
  ShiftObservation,
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

  /** Returns the current authored revision after pending edits settle. */
  fontRevision(ifFontRevision?: FontRevision): Promise<FontRevision> {
    return this.#call("font.revision", { ifFontRevision });
  }

  /** Returns a point-in-time view of the editor owned by this renderer. */
  inspectEditor(ifFontRevision?: FontRevision): Promise<ShiftObservation<EditorView>> {
    return this.#call("editor.inspect", { ifFontRevision });
  }

  getFont(ifFontRevision?: FontRevision): Promise<ShiftObservation<FontOverview>> {
    return this.#call("font.get", { ifFontRevision });
  }

  resolveLocation(
    location: AxisCoordinate[],
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<ResolvedLocation>> {
    return this.#call("locations.resolve", { location, ifFontRevision });
  }

  listGlyphs(input: {
    limit?: number;
    cursor?: string;
    sourceId?: SourceId;
    ifFontRevision?: FontRevision;
  }): Promise<ShiftObservation<GlyphPage>> {
    return this.#call("glyphs.list", input);
  }

  getGlyph(
    selector: GlyphSelector,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<GlyphSummary>> {
    return this.#call("glyphs.get", { selector, ifFontRevision });
  }

  resolveGlyphs(
    glyphIds: GlyphId[],
    location: AxisCoordinate[],
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<ResolvedGlyphs>> {
    return this.#call("glyphs.resolve", { glyphIds, location, ifFontRevision });
  }

  getLayer(
    glyphId: GlyphId,
    sourceId: SourceId,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<AuthoredLayer | null>> {
    return this.#call("layers.get", { glyphId, sourceId, ifFontRevision });
  }

  renderLayer(
    glyphId: GlyphId,
    sourceId: SourceId,
    overlays?: LayerOverlays,
    appearance?: LayerAppearance,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<LayerSvg | null>> {
    return this.#call("layers.render", {
      glyphId,
      sourceId,
      overlays,
      appearance,
      ifFontRevision,
    });
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
