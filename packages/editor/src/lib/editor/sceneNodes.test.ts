import { describe, expect, it } from "vitest";
import { asNodeId, asRunId } from "@shift/types";
import type { RevisedNode, SceneNode } from "../../types/sceneDocument";
import { SceneNodes } from "./sceneNodes";

/** A text run stored inside a frame: filling its width, placed by the frame's layout. */
function storedRun(): SceneNode {
  return {
    id: asNodeId("node_run"),
    parentId: asNodeId("node_frame"),
    index: "a0",
    x: 10,
    y: 20,
    sizing: { width: { kind: "fill" }, height: { kind: "fixed", fixed: 300 } },
    placement: "auto",
    content: {
      kind: "textRun",
      runId: asRunId("run"),
      size: 1000,
      items: [],
      settings: { shaping: true, features: {} },
    },
  };
}

describe("SceneNodes", () => {
  it("keeps a stored node's sizing and placement through an editor update", () => {
    const stored = storedRun();
    const revised: RevisedNode = { node: stored, revision: 1, itemsRevision: 1 };
    const read = new SceneNodes().read([revised], new Map());
    const [node] = read.nodes;
    if (node?.kind !== "textRun") throw new Error("expected the run");

    const moved = { ...node, position: { x: 40, y: 0 } };
    const written = SceneNodes.toDocument(moved, read.runs.get(node.runId) ?? null);

    expect(written.sizing).toEqual(stored.sizing);
    expect(written.placement).toBe("auto");
    expect([written.x, written.y]).toEqual([40, 0]);
  });

  it("writes a node the document has not stored yet hugging, at its position", () => {
    const written = SceneNodes.toDocument(
      {
        id: asNodeId("node_page"),
        type: "node",
        kind: "page",
        parentId: null,
        index: "a0",
        position: { x: 0, y: 0 },
        name: "Page",
      },
      null,
    );

    expect(written.sizing).toEqual({ width: { kind: "hug" }, height: { kind: "hug" } });
    expect(written.placement).toBe("absolute");
  });
});
