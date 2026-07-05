import { beforeEach, describe, expect, it } from "vitest";
import { mintNodeId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Editor scene bootstrap", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  it("places the opened glyph as one glyph node at the origin", () => {
    const record = editor.font.recordForName("A")!;
    const nodes = editor.scene.nodes();

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: "glyph",
      glyphId: record.id,
      sourceId: editor.font.defaultSource.id,
      position: { x: 0, y: 0 },
    });
  });

  it("can place the same glyph id twice with distinct node ids", () => {
    const record = editor.font.recordForName("A")!;
    const left = mintNodeId();
    const right = mintNodeId();

    editor.scene.setNodes([
      {
        id: left,
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a0",
        glyphId: record.id,
        sourceId: editor.font.defaultSource.id,
        position: { x: 0, y: 0 },
      },
      {
        id: right,
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a1",
        glyphId: record.id,
        sourceId: editor.font.defaultSource.id,
        position: { x: 700, y: 0 },
      },
    ]);

    expect(editor.scene.node(left)?.glyphId).toBe(record.id);
    expect(editor.scene.node(right)?.glyphId).toBe(record.id);
    expect(editor.getPointInNodeSpace({ x: 710, y: 20 }, { x: 700, y: 0 })).toEqual({
      x: 10,
      y: 20,
    });

    const rightNode = editor.scene.node(right);
    if (!rightNode) throw new Error("Expected right glyph node");

    editor.scene.updateNode({
      ...rightNode,
      position: { x: rightNode.position.x + 30, y: rightNode.position.y + 5 },
    });

    expect(editor.scene.node(right)?.position).toEqual({ x: 730, y: 5 });
  });
});
