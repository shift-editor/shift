import { asGlyphId, asNodeId, asPointId, asSourceId } from "@shift/types";
import type { ShiftCapabilities } from "@shift/runtime";
import { describe, expect, it } from "vitest";
import { executeShiftCode } from "./execute";

const capabilities: ShiftCapabilities = {
  async capture({ windowId, target, scale = 1 }) {
    return {
      captureId: "capture-a",
      windowId,
      target,
      mimeType: "image/png",
      data: "cG5n",
      width: 800,
      height: 600,
      scale,
      capturedAt: "2026-10-08T10:00:00.000Z",
    };
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
      return {
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
      };
    },
  },
  font: {
    async get() {
      return {
        mode: "workspace",
        metadata: { familyName: "Example" },
        metrics: { unitsPerEm: 1000 },
        glyphCount: 1,
        axes: [],
        sources: [],
        namedInstances: [],
      };
    },
  },
  glyphs: {
    async list() {
      return {
        items: [
          {
            id: asGlyphId("glyph-a"),
            name: "A",
            unicodes: [65],
            componentBaseGlyphIds: [],
            sourceIds: [],
          },
        ],
        nextCursor: null,
      };
    },
    async get({ glyphId, name }) {
      if (name !== undefined && name !== "A") throw new Error(`Glyph ${name} is not in this font`);
      return {
        id: glyphId ?? asGlyphId("glyph-a"),
        name: "A",
        unicodes: [65],
        componentBaseGlyphIds: [],
        sourceIds: [],
      };
    },
  },
  layers: {
    async get() {
      return null;
    },
    async render() {
      return null;
    },
  },
};

describe("Shift sandbox executes bounded code over live capabilities", () => {
  it("captures an explicitly targeted Shift view", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => { const capture = await shift.capture({ windowId: 7, target: 'editor', scale: 2 }); return { ...capture, data: undefined }; }",
    );

    expect(result).toMatchObject({
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

    expect(result).toMatchObject({ windowId: 7, glyph: { name: "A" }, selectionIds: ["point-a"] });
  });

  it("composes font and glyph reads through the typed capabilities", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => { const font = await shift.font.get({ windowId: 7 }); const page = await shift.glyphs.list({ windowId: 7, limit: 1 }); const glyph = await shift.glyphs.get({ windowId: 7, glyphId: page.items[0].id }); const input = { windowId: 7, glyphId: glyph.id, sourceId: 'source-a' }; const layer = await shift.layers.get(input); const rendered = await shift.layers.render({ ...input, overlays: { points: true } }); return { family: font.metadata.familyName, glyph: glyph.name, nextCursor: page.nextCursor, layer, rendered }; }",
    );

    expect(result).toEqual({
      family: "Example",
      glyph: "A",
      nextCursor: null,
      layer: null,
      rendered: null,
    });
  });

  it("gets a glyph by exact name and rejects ambiguous selectors", async () => {
    const result = await executeShiftCode(
      capabilities,
      "async () => shift.glyphs.get({ windowId: 7, name: 'A' })",
    );
    expect(result).toMatchObject({ id: "glyph-a", name: "A" });

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
