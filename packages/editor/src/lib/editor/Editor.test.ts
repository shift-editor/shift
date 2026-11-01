import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asGlyphId,
  asPointId,
  mintContourId,
  mintNodeId,
  mintPointId,
  mintRunId,
} from "@shift/types";
import { startEmptyMemorySession } from "../../testing/emptyMemorySession";
import type { MemoryFontSession } from "../../types/fontSession";
import type { GlyphNode, TextRunNode } from "../../types/node";
import { effect } from "../signals";
import type { Editor } from "./Editor";
import { scenePoint } from "./spaces";

const glyphId = asGlyphId("glyph_A");

describe("Editor scene", () => {
  let session: MemoryFontSession;
  let editor: Editor;
  let run: TextRunNode;
  let child: GlyphNode;

  beforeEach(() => {
    session = startEmptyMemorySession();
    editor = session.editor;
    run = editor.scene.createNode<TextRunNode>({
      kind: "textRun",
      runId: mintRunId(),
      size: 1000,
      position: { x: 0, y: 0 },
    });
    child = editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      parentId: run.id,
      glyphId,
      sourceId: editor.font.defaultSource.id,
      position: { x: 0, y: 0 },
    });
  });
  afterEach(() => session.dispose());

  it("finds the nodes that depend on a run or a glyph, and follows their removal", () => {
    const dependents: number[] = [];
    const reader = effect(() => {
      dependents.push(editor.scene.nodesReferencing(child.glyphId).length);
    });

    expect(editor.scene.nodesReferencing(run.runId)).toEqual([run]);
    expect(editor.scene.nodesReferencing(child.glyphId)).toEqual([child]);

    editor.scene.deleteNode(child.id);
    reader.dispose();

    expect(dependents).toEqual([1, 0]);
  });

  it("keeps the scene value when only the selection changes, and updates it when a node moves", () => {
    const scene = editor.scene.cell.peek();

    editor.selection.select([asPointId("point_selected")]);
    expect(editor.scene.cell.peek()).toBe(scene);

    const [node] = editor.scene.nodes();
    editor.scene.updateNode({ id: node!.id, position: { x: 40, y: 0 } });
    expect(editor.scene.cell.peek()).not.toBe(scene);
    expect(editor.scene.nodes()[0]?.position).toEqual({ x: 40, y: 0 });
  });

  it("leaves the scene as it is when a glyph node is shown in the source it already shows", () => {
    const scene = editor.scene.cell.peek();

    editor.scene.updateNode({ id: child.id, sourceId: child.sourceId });

    expect(editor.scene.cell.peek()).toBe(scene);
  });

  it("names the one glyph node only while the scene shows exactly one", () => {
    const [firstRun, firstChild] = editor.scene.nodes();

    expect(editor.scene.only("glyph")).toBe(firstChild);
    expect(editor.scene.first("textRun")).toBe(firstRun);

    editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      glyphId,
      sourceId: editor.font.defaultSource.id,
      position: { x: 700, y: 0 },
    });

    expect(editor.scene.nodesOfKind("glyph")).toHaveLength(2);
    expect(editor.scene.only("glyph")).toBeNull();
    expect(editor.scene.first("glyph")).toBe(firstChild);
  });

  it("follows the one glyph node reactively as glyph nodes come and go", () => {
    const [, firstChild] = editor.scene.nodes();
    const onlyGlyph = editor.scene.onlyCell("glyph");
    const seen: (string | null)[] = [];
    const reader = effect(() => {
      seen.push(onlyGlyph.value?.id ?? null);
    });

    const second = editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      glyphId,
      sourceId: editor.font.defaultSource.id,
      position: { x: 700, y: 0 },
    });
    expect(onlyGlyph.peek()).toBeNull();

    editor.scene.deleteNode(firstChild!.id);
    reader.dispose();

    expect(onlyGlyph.peek()).toBe(editor.scene.node(second.id));
    expect(seen.at(-1)).toBe(second.id);
    expect(seen).toContain(null);
  });

  it("can place the same glyph id twice with distinct node ids", () => {
    const left = mintNodeId();
    const right = mintNodeId();

    editor.scene.setNodes([
      {
        id: left,
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a0",
        glyphId,
        sourceId: editor.font.defaultSource.id,
        position: { x: 0, y: 0 },
      },
      {
        id: right,
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a1",
        glyphId,
        sourceId: editor.font.defaultSource.id,
        position: { x: 700, y: 0 },
      },
    ]);

    const leftNode = editor.scene.node(left);
    const rightNode = editor.scene.node(right);
    if (leftNode?.kind !== "glyph" || rightNode?.kind !== "glyph") {
      throw new Error("Expected two glyph nodes");
    }

    expect(leftNode.glyphId).toBe(glyphId);
    expect(rightNode.glyphId).toBe(glyphId);
    expect(editor.toLocal(rightNode, scenePoint(710, -20))).toEqual({
      x: 10,
      y: 20,
    });

    editor.scene.updateNode({
      id: rightNode.id,
      position: { x: rightNode.position.x + 30, y: rightNode.position.y + 5 },
    });

    expect(editor.scene.node(right)?.position).toEqual({ x: 730, y: 5 });
  });
});

/**
 * `hideHandles` requests: the Shape tool makes one for the contour it drags
 * out, and every request is released on its own, however requests overlap.
 * Visibility is asked with the owning contour, so no geometry is needed.
 */
describe("Editor handle visibility requests", () => {
  let session: MemoryFontSession;
  let editor: Editor;
  const contourId = mintContourId();
  const [first, second, third] = [mintPointId(), mintPointId(), mintPointId()];
  const visible = (id: typeof first) => editor.handlesVisible(id, contourId);

  beforeEach(() => {
    session = startEmptyMemorySession();
    editor = session.editor;
  });
  afterEach(() => session.dispose());

  it("hides one Bézier handle without hiding its siblings", () => {
    const showHandles = editor.hideHandles(second);
    expect(visible(second)).toBe(false);
    expect(visible(first)).toBe(true);
    expect(editor.handlesVisible(contourId)).toBe(true);
    showHandles();
    expect(visible(second)).toBe(true);
  });

  it("keeps overlapping point and contour requests independent and idempotent", () => {
    const showPoint = editor.hideHandles(second);
    const showContour = editor.hideHandles(contourId);
    showPoint();
    showPoint();
    expect(visible(second)).toBe(false);
    expect(visible(third)).toBe(false);
    showContour();
    expect(visible(second)).toBe(true);
    expect(visible(third)).toBe(true);
  });

  it("retains a point request when a contour request is released first", () => {
    const showPoint = editor.hideHandles(second);
    const showContour = editor.hideHandles(contourId);
    showContour();
    expect(visible(second)).toBe(false);
    expect(visible(third)).toBe(true);
    showPoint();
    expect(visible(second)).toBe(true);
  });

  it("does not release another request for the same point", () => {
    const showFirst = editor.hideHandles(second);
    const showSecond = editor.hideHandles(second);
    showFirst();
    showFirst();
    expect(visible(second)).toBe(false);
    showSecond();
    expect(visible(second)).toBe(true);
  });
});
