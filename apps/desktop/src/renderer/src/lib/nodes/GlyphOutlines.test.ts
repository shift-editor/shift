import { describe, expect, it } from "vitest";
import { asNamedInstanceId, asNodeId, asSourceId } from "@shift/types";
import { GlyphOutlines } from "@shift/editor/testing";

describe("glyph outlines remain scoped to their scene node", () => {
  it("replaces and clears one node without changing another", () => {
    const outlines = new GlyphOutlines();
    const firstNode = asNodeId("node-1");
    const secondNode = asNodeId("node-2");
    const source = { kind: "source", sourceId: asSourceId("source-1") } as const;
    const instance = { kind: "instance", instanceId: asNamedInstanceId("instance-1") } as const;

    outlines.set(firstNode, [source]);
    outlines.set(secondNode, [instance]);
    outlines.set(firstNode, [instance]);
    outlines.clear(firstNode);

    expect(outlines.forNode(firstNode)).toEqual([]);
    expect(outlines.forNode(secondNode)).toEqual([instance]);
  });

  it("treats an empty replacement as clearing the node", () => {
    const outlines = new GlyphOutlines();
    const nodeId = asNodeId("node-1");
    outlines.set(nodeId, [{ kind: "source", sourceId: asSourceId("source-1") }]);

    outlines.set(nodeId, []);

    expect(outlines.forNode(nodeId)).toEqual([]);
  });
});
