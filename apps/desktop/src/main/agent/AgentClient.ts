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
  KerningMasterValue,
  KerningPairPage,
  LayerSvg,
  ResolvedGlyphs,
  ResolvedKerningPairs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftObservation,
  SourceSelector,
  InstanceSelector,
} from "@shift/runtime";
import type { GlyphId, NamedInstance, Source } from "@shift/types";
import type { MessagePortMain } from "electron";
import type {
  AgentCallMap,
  AgentE2ECallMap,
  AgentEventMap,
  EditorCaptureBounds,
} from "../../shared/agent/protocol";
import { Channel, electronPortTransport } from "../../shared/workspace/channel";
import { createShiftLogger, type ShiftLogger } from "../logging";

/** Calls the agent inspection lane served by one renderer window. */
export class AgentClient {
  readonly #log: ShiftLogger;
  #channel: Channel<AgentCallMap & AgentE2ECallMap, AgentEventMap> | null = null;

  constructor(log: ShiftLogger = createShiftLogger("agent.client")) {
    this.#log = log;
  }

  get connected(): boolean {
    return this.#channel !== null && !this.#channel.closed;
  }

  /** Replaces the inspection lane after a renderer connects or reloads. */
  connect(port: MessagePortMain): void {
    this.#channel?.dispose();
    this.#channel = new Channel<AgentCallMap & AgentE2ECallMap, AgentEventMap>(
      electronPortTransport(port),
    );
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
    source?: AgentCallMap["glyphs.list"]["request"]["source"];
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

  getSource(
    selector: SourceSelector,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<Source>> {
    return this.#call("sources.get", { selector, ifFontRevision });
  }

  getInstance(
    selector: InstanceSelector,
    ifFontRevision?: FontRevision,
  ): Promise<ShiftObservation<NamedInstance>> {
    return this.#call("instances.get", { selector, ifFontRevision });
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

  kerningAt(
    input: AgentCallMap["kerning.at"]["request"],
  ): Promise<ShiftObservation<KerningMasterValue>> {
    return this.#call("kerning.at", input);
  }

  getLayer(input: AgentCallMap["layers.get"]["request"]): Promise<ShiftObservation<AuthoredLayer>> {
    return this.#call("layers.get", input);
  }

  resolveLayer(
    input: AgentCallMap["layers.resolve"]["request"],
  ): Promise<ShiftObservation<ResolvedLayer>> {
    return this.#call("layers.resolve", input);
  }

  renderLayer(
    input: AgentCallMap["layers.render"]["request"],
  ): Promise<ShiftObservation<LayerSvg>> {
    return this.#call("layers.render", input);
  }

  /**
   * Calls `reader`'s `method` with `args` in the window's renderer once
   * pending edits settle, as the E2E read hook does.
   */
  read(reader: string, method: string, args: unknown[]): Promise<unknown> {
    return this.#call("agent.read", { reader, method, args });
  }

  /**
   * Calls `method` of the renderer's E2E hook `hook` with `args`, as the E2E
   * hooks do; the renderer serves it only for E2E launches.
   */
  callHook(hook: string, method: string, args: unknown[]): Promise<unknown> {
    return this.#call("e2e.call", { hook, method, args });
  }

  #call<K extends keyof (AgentCallMap & AgentE2ECallMap)>(
    operation: K,
    input: (AgentCallMap & AgentE2ECallMap)[K]["request"],
  ): Promise<(AgentCallMap & AgentE2ECallMap)[K]["response"]> {
    if (!this.#channel) return Promise.reject(new Error("agent renderer is not connected"));
    return this.#channel.call(operation, input);
  }

  /** Disconnects the renderer and rejects pending inspection calls. */
  dispose(): void {
    this.#channel?.dispose();
    this.#channel = null;
  }
}
