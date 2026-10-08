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
import type { AxisId, GlyphId, GlyphState, SourceId } from "@shift/types";
import { GlyphGeometry } from "@shift/glyph-state";
import { renderLayerSvg } from "@shift/editor/rendering";
import { signal } from "@shift/editor/signals";
import {
  axisValue,
  emptyExternalAxisLocation,
  externalAxisLocationFromRecord,
  mapAxisLocation,
} from "@shift/editor/variation";
import type { ExternalAxisLocation } from "@shift/editor/variation";
import type { ShiftHost } from "@shared/host/ShiftHost";
import type { AgentCallMap, AgentEventMap } from "@shared/agent/protocol";
import { domPortTransport, serveChannel, type ChannelServer } from "@shared/workspace/channel";
import type { FontSession } from "@/types/fontSession";

/** Serves bounded editor observations for one live renderer window. */
export class AgentBridge {
  readonly #host: ShiftHost;
  readonly #session: FontSession;
  readonly #revisionNamespace = crypto.randomUUID();
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
        "capture.editorBounds": () => this.#editorCaptureBounds(),
        "font.revision": ({ ifFontRevision }) => this.#readRevision(ifFontRevision),
        "editor.inspect": ({ ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#inspectEditor()),
        "font.get": ({ ifFontRevision }) => this.#observe(ifFontRevision, () => this.#getFont()),
        "locations.resolve": ({ location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#resolveLocation(location)),
        "glyphs.list": ({ limit, cursor, sourceId, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#listGlyphs({ limit, cursor, sourceId })),
        "glyphs.get": ({ selector, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#getGlyph(selector)),
        "glyphs.resolve": ({ glyphIds, location, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#resolveGlyphs(glyphIds, location)),
        "layers.get": ({ glyphId, sourceId, ifFontRevision }) =>
          this.#observe(ifFontRevision, () => this.#getLayer(glyphId, sourceId)),
        "layers.render": ({ glyphId, sourceId, overlays, appearance, ifFontRevision }) =>
          this.#observe(ifFontRevision, () =>
            this.#renderLayer(glyphId, sourceId, overlays, appearance),
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

  #getFont(): FontOverview {
    const font = this.#session.font;
    return {
      mode: this.#session.mode,
      info: font.metadata,
      metrics: font.metrics,
      metricDefinitions: font.metricDefinitions,
      glyphCount: font.glyphEntries().length,
      axes: font.getAxes(),
      sources: font.sources,
      instances: font.namedInstances,
    };
  }

  #resolveLocation(location: AxisCoordinate[]): ResolvedLocation {
    const font = this.#session.font;
    const external = externalLocation(font.getAxes(), location);
    const design = mapAxisLocation(external, font.getAxes(), font.getAxisMappingBases());

    return {
      externalLocation: font
        .getAxes()
        .map((axis) => ({ axisId: axis.id, value: axisValue(external, axis) })),
      designLocation: font
        .getAxes()
        .map((axis) => ({ axisId: axis.id, value: axisValue(design, axis) })),
      sourceId: font.sourceAt(external)?.id ?? null,
      metrics: font.metricsAtLocation(external),
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
      const layers = await font.readAuthoredLayers({
        glyphIds: page.map(({ id }) => id),
        sourceId,
      });
      for (const [index, item] of items.entries()) {
        const layer = layers[index];
        item.layer = layer ? authoredLayer(item.id, sourceId, layer.state) : null;
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

  async #resolveGlyphs(glyphIds: GlyphId[], location: AxisCoordinate[]): Promise<ResolvedGlyphs> {
    const font = this.#session.font;
    for (const glyphId of glyphIds) {
      if (!font.entryForId(glyphId)) throw new Error(`Glyph ${glyphId} is not in this font`);
    }

    const external = externalLocation(font.getAxes(), location);
    const design = mapAxisLocation(external, font.getAxes(), font.getAxisMappingBases());
    const previews = await font.glyphPreviews(glyphIds, design);
    const resolvedIds = new Set(previews.map(({ glyphId }) => glyphId));

    return {
      items: previews.map(({ glyphId, svgPath, xAdvance }) => ({
        glyphId,
        svgPath,
        advanceWidth: xAdvance,
      })),
      unresolvedGlyphIds: glyphIds.filter((glyphId) => !resolvedIds.has(glyphId)),
    };
  }

  async #getLayer(glyphId: GlyphId, sourceId: SourceId): Promise<AuthoredLayer | null> {
    const [layer] = await this.#session.font.readAuthoredLayers({ glyphIds: [glyphId], sourceId });
    return layer ? authoredLayer(glyphId, sourceId, layer.state) : null;
  }

  async #renderLayer(
    glyphId: GlyphId,
    sourceId: SourceId,
    overlays: LayerOverlays | undefined,
    appearance: LayerAppearance | undefined,
  ): Promise<LayerSvg | null> {
    const [layer] = await this.#session.font.readAuthoredLayers({ glyphIds: [glyphId], sourceId });
    if (!layer) return null;

    const geometry = GlyphGeometry.fromState(layer.state);
    const glyph = await this.#session.font.loadGlyph(glyphId);
    const location =
      this.#session.font.externalLocationForSource(sourceId) ?? emptyExternalAxisLocation();
    const renderModel = glyph.renderModelAt(signal(location), signal<SourceId | null>(sourceId));
    const directComponents = renderModel.components.filter(
      (component) => component.parentPath.length === 0,
    );
    if (directComponents.length !== geometry.components.length) {
      throw new Error(`Layer ${layer.state.layerId} has an unresolved or cyclic component`);
    }
    for (const component of renderModel.components) {
      const componentGeometry = renderModel.geometryAt(component.glyphId, renderModel.location);
      if (component.children.length !== componentGeometry.components.length) {
        throw new Error(`Layer ${layer.state.layerId} has an unresolved or cyclic component`);
      }
    }

    const metrics = this.#session.font.source(sourceId)
      ? this.#session.font.metricsForSource(sourceId)
      : this.#session.font.defaultSourceMetrics;
    const rendered = renderLayerSvg(
      geometry,
      metrics,
      overlays,
      renderModel.components,
      appearance,
    );
    return {
      glyphId,
      sourceId,
      layerId: layer.state.layerId,
      ...rendered,
    };
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

  const record = session.font.recordForId(glyphId);
  return {
    id: entry.id,
    name: entry.name,
    unicodes: [...entry.unicodes],
    componentBaseGlyphIds: record?.componentBaseGlyphIds ?? [],
    layers: record?.layers.map(({ id, sourceId }) => ({ layerId: id, sourceId })) ?? [],
  };
}

function authoredLayer(glyphId: GlyphId, sourceId: SourceId, state: GlyphState): AuthoredLayer {
  const geometry = GlyphGeometry.fromState(state);
  return {
    glyphId,
    sourceId,
    layerId: state.layerId,
    advanceWidth: geometry.xAdvance,
    bounds: geometry.bounds,
    contours: geometry.contours.map((contour) => ({
      id: contour.id,
      closed: contour.closed,
      points: contour.points.map(({ id, x, y, pointType, smooth }) => ({
        id,
        x,
        y,
        pointType,
        smooth,
      })),
    })),
    components: geometry.components.map((component) => {
      const matrix = component.matrix;
      return {
        id: component.id,
        baseGlyphId: component.baseGlyphId,
        baseGlyphName: component.baseGlyphName,
        transformation: {
          xx: matrix.a,
          xy: matrix.b,
          yx: matrix.c,
          yy: matrix.d,
          dx: matrix.e,
          dy: matrix.f,
        },
      };
    }),
    anchors: geometry.anchors.map(({ id, name, x, y }) => ({
      id,
      name: name ?? null,
      x,
      y,
    })),
  };
}

function externalLocation(
  axes: readonly { id: AxisId }[],
  coordinates: AxisCoordinate[],
): ExternalAxisLocation {
  const axisIds = new Set(axes.map(({ id }) => id));
  const values: Record<string, number> = {};
  for (const { axisId, value } of coordinates) {
    if (!axisIds.has(axisId)) throw new Error(`Unknown axis: ${axisId}`);
    if (axisId in values) throw new Error(`Duplicate axis coordinate: ${axisId}`);
    values[axisId] = value;
  }
  return externalAxisLocationFromRecord(values);
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
