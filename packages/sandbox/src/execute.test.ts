import { asGlyphId, asNodeId, asPointId, asSourceId } from "@shift/types";
import type { ShiftCapabilities, ShiftObservation } from "@shift/runtime";
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
    async get() {
      return observation(null);
    },
    async render() {
      return observation(null);
    },
  },
};

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
      "async () => { const font = await shift.font.get({ windowId: 7 }); const ifFontRevision = font.fontRevision; const page = await shift.glyphs.list({ windowId: 7, limit: 1, ifFontRevision }); const glyph = await shift.glyphs.get({ windowId: 7, glyphId: page.value.items[0].id, ifFontRevision }); const location = await shift.locations.resolve({ windowId: 7, location: [], ifFontRevision }); const resolved = await shift.glyphs.resolve({ windowId: 7, glyphIds: [glyph.value.id], location: location.value.externalLocation, ifFontRevision }); const input = { windowId: 7, glyphId: glyph.value.id, sourceId: 'source-a', ifFontRevision }; const layer = await shift.layers.get(input); const rendered = await shift.layers.render({ ...input, overlays: { points: true } }); return { family: font.value.info.familyName, glyph: glyph.value.name, nextCursor: page.value.nextCursor, advanceWidth: resolved.value.items[0].advanceWidth, layer: layer.value, rendered: rendered.value }; }",
    );

    expect(result).toEqual({
      family: "Example",
      glyph: "A",
      nextCursor: null,
      advanceWidth: 600,
      layer: null,
      rendered: null,
    });
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
