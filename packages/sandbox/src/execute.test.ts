import { asGlyphId, asLayerId, asNodeId, asPointId, asSourceId } from "@shift/types";
import {
  FontChangedError,
  ShiftReadScope,
  type LayerGetInput,
  type ShiftCapabilities,
  type ShiftObservation,
  type ShiftRead,
} from "@shift/runtime";
import { describe, expect, it } from "vitest";
import { executeShiftCode } from "./execute";

const FONT_REVISION = "revision-a";

function observation<Value>(value: Value): ShiftObservation<Value> {
  return { fontRevision: FONT_REVISION, value };
}

const capabilities: ShiftCapabilities = {
  async capture({ windowId, target, scale = 1 }) {
    return observation({
      captureId: "capture-a",
      windowId,
      target,
      mimeType: "image/png",
      data: "cG5n",
      width: 800,
      height: 600,
      scale,
      capturedAt: "2026-10-08T10:00:00.000Z",
    });
  },
  sessions: {
    async list() {
      return [
        {
          windowId: 7,
          sessionId: "session-a",
          mode: "workspace",
          focused: true,
          editorConnected: true,
        },
      ];
    },
  },
  editor: {
    async inspect({ windowId }) {
      return observation({
        windowId,
        sessionId: "session-a",
        mode: "workspace",
        route: "/editor/glyph-a",
        glyph: {
          glyphId: asGlyphId("glyph-a"),
          name: "A",
          nodeId: asNodeId("node-a"),
          sourceId: asSourceId("source-a"),
        },
        activeSourceId: asSourceId("source-a"),
        editingSourceIds: [asSourceId("source-a")],
        externalLocation: [],
        selectionIds: [asPointId("point-a")],
        tool: { id: "select", state: "idle" },
        dragging: false,
        editing: true,
        applyStatus: "idle",
      });
    },
  },
  font: {
    async get() {
      return observation({
        mode: "workspace",
        info: { familyName: "Example" },
        metrics: { unitsPerEm: 1000 },
        metricDefinitions: [],
        glyphCount: 1,
        axes: [],
        sources: [],
        instances: [],
      });
    },
  },
  locations: {
    async resolve() {
      return observation({
        externalLocation: [],
        designLocation: [],
        sourceId: null,
        metrics: {
          unitsPerEm: 1000,
          metricValues: [],
          ascender: 800,
          descender: -200,
          baseline: 0,
        },
      });
    },
  },
  glyphs: {
    async list() {
      return observation({
        items: [
          {
            id: asGlyphId("glyph-a"),
            name: "A",
            unicodes: [65],
            componentBaseGlyphIds: [],
            layers: [],
          },
        ],
        nextCursor: null,
      });
    },
    async get({ glyphId, name }) {
      if (name !== undefined && name !== "A") throw new Error(`Glyph ${name} is not in this font`);
      return observation({
        id: glyphId ?? asGlyphId("glyph-a"),
        name: "A",
        unicodes: [65],
        componentBaseGlyphIds: [],
        layers: [],
      });
    },
    async resolve({ glyphIds }) {
      return observation({
        items: glyphIds.map((glyphId) => ({ glyphId, svgPath: "M0 0Z", advanceWidth: 600 })),
        unresolvedGlyphIds: [],
      });
    },
  },
  layers: {
    async get({ layerId }) {
      return observation(authoredLayer(layerId));
    },
    async resolve({ layerId }) {
      return observation({
        ...layerIdentity(layerId),
        advanceWidth: 600,
        outline: { svgPath: "M0 0Z", bounds: null },
        components: [],
      });
    },
    async render({ layerId }) {
      return observation({
        ...layerIdentity(layerId),
        viewBox: [0, 0, 600, 1000],
        guides: {
          fontMetrics: { ascender: 800, baseline: 0, descender: -200 },
          advanceWidth: { origin: 0, advance: 600 },
        },
        svg: "<svg/>",
      });
    },
  },
};

function layerIdentity(layerId: LayerGetInput["layerId"]) {
  if (layerId !== "layer-a") throw new Error(`Layer ${layerId} is not in this font`);
  return { glyphId: asGlyphId("glyph-a"), sourceId: asSourceId("source-a"), layerId };
}

function authoredLayer(layerId: LayerGetInput["layerId"]) {
  return {
    ...layerIdentity(layerId),
    advanceWidth: 600,
    bounds: null,
    contours: [],
    components: [],
    anchors: [],
  };
}

describe("Shift sandbox executes bounded code over live capabilities", () => {
  it("captures an explicitly targeted Shift view", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => { const observation = await shift.capture({ windowId: 7, target: 'editor', scale: 2 }); const { data, ...capture } = observation.value; return { fontRevision: observation.fontRevision, ...capture }; }",
    );

    expect(result).toMatchObject({
      fontRevision: FONT_REVISION,
      captureId: "capture-a",
      windowId: 7,
      target: "editor",
      width: 800,
      height: 600,
      scale: 2,
    });
  });

  it("composes session discovery and editor inspection", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => { const [session] = await shift.sessions.list(); return shift.editor.inspect({ windowId: session.windowId }); }",
    );

    expect(result).toMatchObject({
      fontRevision: FONT_REVISION,
      value: { windowId: 7, glyph: { name: "A" }, selectionIds: ["point-a"] },
    });
  });

  it("composes revision-guarded font, location, glyph, and layer reads", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => { const font = await shift.font.get({ windowId: 7 }); const ifFontRevision = font.fontRevision; const page = await shift.glyphs.list({ windowId: 7, limit: 1, ifFontRevision }); const glyph = await shift.glyphs.get({ windowId: 7, glyphId: page.value.items[0].id, ifFontRevision }); const location = await shift.locations.resolve({ windowId: 7, location: [], ifFontRevision }); const resolved = await shift.glyphs.resolve({ windowId: 7, glyphIds: [glyph.value.id], location: location.value.externalLocation, ifFontRevision }); const input = { windowId: 7, layerId: 'layer-a', ifFontRevision }; const layer = await shift.layers.get(input); const resolvedLayer = await shift.layers.resolve(input); const rendered = await shift.layers.render({ ...input, overlays: { points: true } }); return { family: font.value.info.familyName, glyph: glyph.value.name, nextCursor: page.value.nextCursor, advanceWidth: resolved.value.items[0].advanceWidth, layerIds: [layer.value.layerId, resolvedLayer.value.layerId, rendered.value.layerId] }; }",
    );

    expect(result).toEqual({
      family: "Example",
      glyph: "A",
      nextCursor: null,
      advanceWidth: 600,
      layerIds: ["layer-a", "layer-a", "layer-a"],
    });
  });

  it("rejects layer reads addressed by glyph and source", async () => {
    await expect(
      executeShiftCode(
        capabilities,
        "async () => shift.layers.get({ windowId: 7, glyphId: 'glyph-a', sourceId: 'source-a' })",
      ),
    ).rejects.toThrow();
  });

  it("gets a glyph by exact name and rejects ambiguous selectors", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => shift.glyphs.get({ windowId: 7, name: 'A' })",
    );
    expect(result).toMatchObject({ value: { id: "glyph-a", name: "A" } });

    await expect(
      executeShiftCode(
        capabilities,
        "async () => shift.glyphs.get({ windowId: 7, name: 'A', glyphId: 'glyph-a' })",
      ),
    ).rejects.toThrow();
  });

  it("rejects an invalid glyph page before it reaches the host", async () => {
    await expect(
      executeShiftCode(capabilities, "async () => shift.glyphs.list({ windowId: 7, limit: 0 })"),
    ).rejects.toThrow();
  });

  it("cannot access Node process globals", async () => {
    await expect(executeShiftCode(capabilities, "async () => typeof process")).resolves.toBe(
      "undefined",
    );
  });

  it("starts each execution in a fresh realm", async () => {
    await executeShiftCode(capabilities, "async () => { globalThis.ephemeral = 1; return null; }");
    await expect(
      executeShiftCode(capabilities, "async () => typeof globalThis.ephemeral"),
    ).resolves.toBe("undefined");
  });

  it("requires a JSON-compatible result", async () => {
    await expect(executeShiftCode(capabilities, "async () => undefined")).rejects.toThrow(
      "Shift script must return a JSON value",
    );
  });

  it("stops code that never settles", async () => {
    await expect(
      executeShiftCode(capabilities, "async () => await new Promise(() => {})"),
    ).rejects.toThrow("Shift script timed out");
  });
});

/** Capabilities whose revision advances on demand and that enforce `ifFontRevision`. */
function revisionedCapabilities({ advanceAfter }: { advanceAfter?: string } = {}) {
  let revision = 1;
  const calls: { method: string; ifFontRevision?: string }[] = [];
  const current = () => `revision-${revision}`;
  const guarded =
    <Input extends { ifFontRevision?: string }, Value>(
      method: string,
      read: (input: Input) => Value,
    ) =>
    async (input: Input): Promise<ShiftObservation<Value>> => {
      calls.push({ method, ifFontRevision: input.ifFontRevision });
      if (input.ifFontRevision && input.ifFontRevision !== current()) {
        throw new Error(
          `Font revision mismatch: expected ${input.ifFontRevision}, current ${current()}`,
        );
      }
      const result = { fontRevision: current(), value: read(input) };
      if (method === advanceAfter) revision++;
      return result;
    };
  const revisioned: ShiftCapabilities = {
    ...capabilities,
    font: {
      get: guarded("font.get", () => ({
        mode: "workspace" as const,
        info: { familyName: `Example ${revision}` },
        metrics: { unitsPerEm: 1000 },
        metricDefinitions: [],
        glyphCount: 1,
        axes: [],
        sources: [],
        instances: [],
      })),
    },
    layers: {
      get: guarded("layers.get", ({ layerId }) => authoredLayer(layerId)),
      resolve: guarded("layers.resolve", ({ layerId }) => ({
        ...layerIdentity(layerId),
        advanceWidth: 600,
        outline: { svgPath: "M0 0Z", bounds: null },
        components: [],
      })),
      render: capabilities.layers.render,
    },
  };

  return {
    capabilities: revisioned,
    calls,
    advance() {
      revision++;
    },
  };
}

describe("shift.read binds one font revision for its callback", () => {
  it("injects the bound revision and unwraps observations", async () => {
    const host = revisionedCapabilities();

    const result = await executeShiftCode(
      host.capabilities,
      "async () => shift.read({ windowId: 7 }, async (read) => { const font = await read.font.get(); const layer = await read.layers.get({ layerId: 'layer-a' }); const resolved = await read.layers.resolve({ layerId: 'layer-a' }); return { revision: read.fontRevision, state: read.state, family: font.info.familyName, layerIds: [layer.layerId, resolved.layerId] }; })",
    );

    expect(result).toEqual({
      revision: "revision-1",
      state: "active",
      family: "Example 1",
      layerIds: ["layer-a", "layer-a"],
    });
    expect(host.calls).toEqual([
      { method: "font.get", ifFontRevision: undefined },
      { method: "layers.get", ifFontRevision: "revision-1" },
      { method: "layers.resolve", ifFontRevision: "revision-1" },
    ]);
  });

  it("goes stale on a revision mismatch, fails later calls immediately, and never retries", async () => {
    const host = revisionedCapabilities({ advanceAfter: "layers.get" });

    const result = await executeShiftCode(
      host.capabilities,
      "async () => { let runs = 0; const seen = []; try { await shift.read({ windowId: 7 }, async (read) => { runs++; await read.layers.get({ layerId: 'layer-a' }); try { await read.layers.resolve({ layerId: 'layer-a' }); } catch (error) { seen.push([error.name, read.state]); } await read.font.get(); }); } catch (error) { seen.push([error.name, error.message]); } return { runs, seen }; }",
    );

    expect(result).toEqual({
      runs: 1,
      seen: [
        ["FontChangedError", "stale"],
        [
          "FontChangedError",
          "The font changed during shift.read (expected revision revision-1, now revision-2); start a new read",
        ],
      ],
    });
  });

  it("classifies failures without parsing error text", async () => {
    const host = revisionedCapabilities();
    const read = await ShiftReadScope.open(host.capabilities, { windowId: 7 });

    await expect(read.layers.get({ layerId: asLayerId("missing") })).rejects.toThrow(
      "Layer missing is not in this font",
    );
    expect(read.state).toBe("active");

    host.advance();
    const stale = await read.layers.get({ layerId: asLayerId("layer-a") }).catch((error) => error);
    expect(stale).toBeInstanceOf(FontChangedError);
    expect(stale).toMatchObject({ expectedRevision: "revision-1", actualRevision: "revision-2" });
    expect(read.state).toBe("stale");

    const callsBefore = host.calls.length;
    await expect(read.font.get()).rejects.toBe(stale);
    await expect(read.layers.resolve({ layerId: asLayerId("layer-a") })).rejects.toBe(stale);
    expect(host.calls).toHaveLength(callsBefore);
  });

  it("ends the scope when its callback settles", async () => {
    const host = revisionedCapabilities();
    let leaked: ShiftRead | null = null;

    await ShiftReadScope.run(host.capabilities, { windowId: 7 }, (read) => {
      leaked = read;
    });

    expect(leaked!.state).toBe("closed");
    await expect(leaked!.font.get()).rejects.toThrow("This shift.read scope has ended");
    await expect(
      executeShiftCode(
        host.capabilities,
        "async () => { let leaked; await shift.read({ windowId: 7 }, (read) => { leaked = read; }); try { await leaked.layers.get({ layerId: 'layer-a' }); } catch (error) { return [leaked.state, error.message]; } }",
      ),
    ).resolves.toEqual(["closed", "This shift.read scope has ended; read inside its callback"]);
  });

  it("rejects inputs that try to rebind the window or revision", async () => {
    const host = revisionedCapabilities();

    await expect(
      executeShiftCode(
        host.capabilities,
        "async () => shift.read({ windowId: 7 }, (read) => read.layers.get({ layerId: 'layer-a', windowId: 8 }))",
      ),
    ).rejects.toThrow("shift.read binds windowId and ifFontRevision");
  });
});
