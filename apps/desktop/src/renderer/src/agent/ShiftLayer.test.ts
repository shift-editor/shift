import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { GlyphName, LayerId } from "@shift/types";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";
import { ShiftLayer } from "./ShiftLayer";

const MUTATOR_SANS = resolve(
  process.cwd(),
  "../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace",
);

describe("ShiftLayer derives every public view from one layer read", () => {
  let stack: WorkspaceStack;

  beforeEach(async () => {
    stack = createWorkspaceStack();
    await stack.openWorkspace(MUTATOR_SANS);
  });

  afterEach(() => stack.dispose());

  function layerFor(glyphName: string, sourceName: string): LayerId {
    const record = stack.font.recordForName(glyphName as GlyphName);
    const source = stack.font.sources.find((candidate) => candidate.name === sourceName);
    const layer = record?.layers.find((candidate) => candidate.sourceId === source?.id);
    if (!layer) throw new Error(`Expected ${glyphName} in ${sourceName}`);
    return layer.id;
  }

  it("gives authored, resolved, and rendered views one identity and geometry", async () => {
    const layerId = layerFor("Aacute", "BoldWide");
    const layer = await ShiftLayer.read(stack.font, layerId);

    const authored = layer.authored();
    const resolved = layer.resolved();
    const rendered = layer.render(stack.font.metricsForSource(layer.identity.sourceId), {
      overlays: { components: true },
    });

    expect(layer.identity.layerId).toBe(layerId);
    for (const view of [authored, resolved, rendered]) {
      expect({ glyphId: view.glyphId, sourceId: view.sourceId, layerId: view.layerId }).toEqual(
        layer.identity,
      );
    }
    expect(resolved.advanceWidth).toBe(authored.advanceWidth);
    expect(resolved.components.map(({ id }) => id)).toEqual(
      authored.components.map(({ id }) => id),
    );
    expect(rendered.svg).toContain(`d="${resolved.outline.svgPath}"`);
    for (const component of resolved.components) {
      expect(component.outline.bounds).not.toBeNull();
      expect(rendered.svg).toContain(`data-shift-id="${component.id}"`);
    }
  });

  it("matches an authored-only read and refuses to resolve or render it", async () => {
    const layerId = layerFor("Aacute", "BoldWide");
    const authoredOnly = await ShiftLayer.readAuthored(stack.font, layerId);
    const full = await ShiftLayer.read(stack.font, layerId);

    expect(authoredOnly.authored()).toEqual(full.authored());
    expect(() => authoredOnly.resolved()).toThrow("was read without resolved geometry");
    expect(() => authoredOnly.render(stack.font.defaultSourceMetrics)).toThrow(
      "was read without resolved geometry",
    );
  });
});
