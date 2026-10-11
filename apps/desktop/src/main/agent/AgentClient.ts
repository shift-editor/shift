import type {
  AuthoredLayer,
  AxisCoordinate,
  EditorView,
  FontOverview,
  FontRevision,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  KerningGroupSummary,
  KerningPairPage,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  ResolvedGlyphs,
  ResolvedKerningPairs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftObservation,
} from "@shift/runtime";
import type { GlyphId, LayerId, SourceId } from "@shift/types";
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

  kerningGroups(
    input: AgentCallMap["kerning.groups"]["request"],
  ): Promise<ShiftObservation<KerningGroupSummary[]>> {
    return this.#call("kerning.groups", input);
  }

  kerningPairs(
    input: AgentCallMap["kerning.pairs"]["request"],
  ): Promise<ShiftObservation<KerningPairPage>> {
    return this.#call("kerning.pairs", input);
  }

  resolveKerning(
    input: AgentCallMap["kerning.resolve"]["request"],
  ): Promise<ShiftObservation<ResolvedKerningPairs>> {
    return this.#call("kerning.resolve", input);
  }

  getLayer(
    layerId: LayerId,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<AuthoredLayer>> {
    return this.#call("layers.get", { layerId, ifFontRevision });
  }

  resolveLayer(
    layerId: LayerId,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<ResolvedLayer>> {
    return this.#call("layers.resolve", { layerId, ifFontRevision });
  }

  renderLayer(
    layerId: LayerId,
    overlays?: LayerOverlays,
    appearance?: LayerAppearance,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<LayerSvg>> {
    return this.#call("layers.render", { layerId, overlays, appearance, ifFontRevision });
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
