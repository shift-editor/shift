import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bounds, Mat, type Point2D } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type { TextRunNode } from "@shift/editor/types";
import { localPoint, scenePoint } from "@shift/editor/spaces";
import { TestEditor } from "@/testing/TestEditor";

const TEXT = "AA AA AA";

/** A text box on a fresh page, showing `TEXT` at one scene unit per font unit. */
function addBox(editor: TestEditor, width: TextRunNode["width"] = { kind: "hug" }): TextRunNode {
  return editor.history.withoutRecording(() => {
    const run = editor.text.createRun(editor.text.itemsFromText(TEXT));
    return editor.scene.createNode<TextRunNode>({
      kind: "textRun",
      runId: run.id,
      size: editor.font.metricsCell.peek().unitsPerEm,
      width,
      height: { kind: "hug" },
      rotation: 0,
      verticalAlign: "top",
      position: { x: 0, y: 0 },
    });
  });
}

function box(editor: TestEditor, id: NodeId): TextRunNode {
  const node = editor.scene.nodeOfKind(id, "textRun");
  if (!node) throw new Error("Expected a text box");
  return node;
}

function sceneRect(editor: TestEditor, id: NodeId) {
  return Bounds.toRect(editor.nodeBounds(box(editor, id))!);
}

function lines(editor: TestEditor, id: NodeId): number {
  return editor.text.boxLayoutCell(box(editor, id)).peek()!.lines.length;
}

describe("a text box", () => {
  let editor: TestEditor;
  let hugWidth: number;

  beforeEach(async () => {
    editor = await new TestEditor().startSession();
    await editor.addGlyph("space", 32);
    editor.pages.activate(editor.pages.create().id);
    const probe = addBox(editor);
    await editor.settle();
    hugWidth = sceneRect(editor, probe.id).width;
    editor.history.withoutRecording(() => editor.scene.deleteNode(probe.id));
  });

  it("keeps a paragraph on one line while it hugs, with its top-left corner at its position", async () => {
    const node = addBox(editor);
    await editor.settle();

    expect(lines(editor, node.id)).toBe(1);
    expect(sceneRect(editor, node.id)).toMatchObject({ x: 0, y: 0 });
  });

  it("wraps after spaces at a fixed width and grows a line height per line", async () => {
    const node = addBox(editor);
    await editor.settle();
    const oneLine = sceneRect(editor, node.id).height;

    editor.scene.updateNode({ id: node.id, width: { kind: "fixed", size: hugWidth * 0.7 } });

    expect(lines(editor, node.id)).toBe(2);
    expect(sceneRect(editor, node.id).width).toBeCloseTo(hugWidth * 0.7);
    expect(sceneRect(editor, node.id).height).toBeCloseTo(oneLine * 2);
  });

  it("breaks a word wider than the box between its letters", async () => {
    const node = addBox(editor, { kind: "fixed", size: hugWidth * 0.2 });
    await editor.settle();

    // Each "AA" is wider than the box, so every letter takes a line.
    expect(lines(editor, node.id)).toBe(6);
  });

  it("follows typed text with its hit area", async () => {
    const node = addBox(editor);
    await editor.settle();
    const before = sceneRect(editor, node.id);
    const past = scenePoint(before.right + before.width / 2, before.y + before.height / 2);
    expect(editor.getPointerTarget(past).kind).toBe("canvas");

    editor.text.setItems(node.runId, editor.text.itemsFromText(`${TEXT} ${TEXT}`));
    await editor.settle();

    expect(editor.getPointerTarget(past)).toMatchObject({ kind: "node", node: { id: node.id } });
  });

  it("edits a glyph in place at the box's size and turn", async () => {
    const node = addBox(editor);
    editor.history.withoutRecording(() =>
      editor.scene.updateNode({ id: node.id, size: 48, rotation: Math.PI / 4 }),
    );
    await editor.settle();
    const item = editor.text.items(box(editor, node.id))[0]!;

    const child = editor.history.capture("Edit glyph", () =>
      editor.nodeDefinition("textRun").editItem(box(editor, node.id), item.id),
    )!;

    const units = editor.font.metricsCell.peek().unitsPerEm;
    const glyph = editor.sceneTransform(child);
    const run = editor.sceneTransform(box(editor, node.id));
    expect(Math.hypot(glyph.a, glyph.b)).toBeCloseTo(48 / units);
    expect([glyph.a, glyph.b, glyph.c, glyph.d]).toEqual(
      [run.a, run.b, run.c, run.d].map((value) => expect.closeTo(value)),
    );
  });
});

describe("the Select tool and a text box", () => {
  let editor: TestEditor;
  let node: TextRunNode;

  beforeEach(async () => {
    editor = await new TestEditor().startSession();
    editor.pages.activate(editor.pages.create().id);
    node = addBox(editor);
    await editor.settle();
    editor.selectTool("select");
    editor.zoomToFit();
  });

  const rect = () => sceneRect(editor, node.id);
  const clickScene = (point: Point2D) => {
    const screen = editor.sceneToScreen(scenePoint(point.x, point.y));
    return editor.click(screen.x, screen.y);
  };
  const dragScene = (from: Point2D, dx: number) =>
    editor.dragScene({
      down: from,
      start: { x: from.x + Math.sign(dx) * 4, y: from.y },
      end: { x: from.x + dx, y: from.y },
    });

  it("selects the whole box with a click on its text", async () => {
    const { x, y, height } = rect();
    await clickScene({ x: x + 10, y: y + height / 2 });

    expect(editor.selection.ids).toEqual([node.id]);
  });

  it("moves a selected box by dragging inside it, as one undo step", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    const before = rect();

    await dragScene({ x: before.x + 10, y: before.y + before.height / 2 }, 200);

    expect(rect().x).toBeCloseTo(before.x + 200);
    await editor.undo();
    expect(rect().x).toBeCloseTo(before.x);
  });

  it("fixes the height when its bottom edge is dragged, and fits its lines again on double-click", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    const before = rect();
    const edge = { x: before.x + before.width / 2, y: before.bottom };

    await editor.dragScene({
      down: edge,
      start: { x: edge.x, y: edge.y + 4 },
      end: { x: edge.x, y: edge.y + before.height },
    });

    expect(box(editor, node.id).height.kind).toBe("fixed");
    expect(rect().height).toBeCloseTo(before.height * 2);
    expect(lines(editor, node.id)).toBe(1);

    const after = rect();
    await clickScene({ x: after.x + after.width / 2, y: after.bottom });
    await clickScene({ x: after.x + after.width / 2, y: after.bottom });
    expect(box(editor, node.id).height).toEqual({ kind: "hug" });
  });

  it("turns about the transform box's pivot, keeping its size", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    const before = rect();
    const target = editor.transformTarget()!;
    const { x, y, width, height } = target.bounds;
    const center = { x: x + width / 2, y: y + height / 2 };
    const turn = Math.PI / 6;
    const aboutCenter = Mat.Compose(
      Mat.Translate(center.x, center.y),
      Mat.Compose(Mat.Rotate(turn), Mat.Translate(-center.x, -center.y)),
    );

    const edit = target.begin("rotate");
    edit.preview(() => aboutCenter);
    edit.commit();

    // The run's units are Y-up, so a turn there is the opposite turn on the canvas.
    expect(box(editor, node.id).rotation).toBeCloseTo(-turn);
    const after = editor.nodeBounds(box(editor, node.id))!;
    expect((after.min.x + after.max.x) / 2).toBeCloseTo(before.x + before.width / 2);
    expect((after.min.y + after.max.y) / 2).toBeCloseTo(before.y + before.height / 2);
    expect(
      Bounds.width(editor.nodeDefinition("textRun").bounds(box(editor, node.id))!),
    ).toBeCloseTo(width);
  });

  it("resizes both sides from a corner without scaling the text", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    const before = rect();
    const size = node.size;

    await editor.dragScene({
      down: { x: before.right, y: before.bottom },
      start: { x: before.right - 4, y: before.bottom + 4 },
      end: { x: before.right - before.width * 0.3, y: before.bottom + before.height },
    });

    expect(box(editor, node.id)).toMatchObject({
      size,
      width: { kind: "fixed" },
      height: { kind: "fixed" },
    });
    expect(rect()).toMatchObject({ x: before.x, y: before.y });
    expect(rect().height).toBeCloseTo(before.height * 2);
    expect(lines(editor, node.id)).toBe(2);
  });

  it("drags a copy with Alt, leaving the box where it was, and shows the copy cursor", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    const before = rect();
    const inside = { x: before.x + 10, y: before.y + before.height / 2 };
    const screen = editor.sceneToScreen(scenePoint(inside.x, inside.y));
    editor.pointerMove(screen.x, screen.y, { altKey: true });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "copy" });

    await editor.dragScene({
      down: inside,
      start: { x: inside.x + 4, y: inside.y },
      end: { x: inside.x + 300, y: inside.y },
      options: { altKey: true },
    });

    const boxes = editor.scene.nodesOfKind("textRun");
    expect(boxes).toHaveLength(2);
    expect(rect()).toMatchObject({ x: before.x, y: before.y });
    const copy = boxes.find((other) => other.id !== node.id)!;
    expect(sceneRect(editor, copy.id).x).toBeCloseTo(before.x + 300);
    expect(editor.selection.ids).toEqual([copy.id]);

    await editor.undo();
    expect(editor.scene.nodesOfKind("textRun")).toHaveLength(1);
  });

  it("starts typing where its empty space is double-clicked", async () => {
    editor.history.withoutRecording(() =>
      editor.scene.updateNode({ id: node.id, width: { kind: "fixed", size: rect().width * 2 } }),
    );
    await editor.settle();
    const { right, y, height } = rect();
    const empty = { x: right - 10, y: y + height / 2 };

    await clickScene(empty);
    await clickScene(empty);

    expect(editor.toolIf("text")?.state.type).toBe("editing");
    expect(editor.textEditing.state?.nodeId).toBe(node.id);
    expect(editor.runGlyph).toBeNull();
  });

  it("sits its lines at the bottom of a taller fixed box when aligned to the bottom", async () => {
    const lineTop = () => editor.toScene(box(editor, node.id), localPoint(0, 0)).y;
    const { height } = rect();
    editor.history.withoutRecording(() =>
      editor.scene.updateNode({ id: node.id, height: { kind: "fixed", size: height * 3 } }),
    );
    const top = lineTop();

    editor.text.setVerticalAlign(node.id, "bottom");
    expect(lineTop()).toBeCloseTo(top + height * 2);
    expect(rect()).toMatchObject({ y: 0 });
    expect(rect().height).toBeCloseTo(height * 3);

    editor.text.setVerticalAlign(node.id, "middle");
    expect(lineTop()).toBeCloseTo(top + height);
  });

  it("snaps its left edge onto another box's while moving", async () => {
    const other = editor.history.withoutRecording(() => {
      const run = editor.text.createRun(editor.text.itemsFromText("AA"));
      return editor.scene.createNode<TextRunNode>({
        kind: "textRun",
        runId: run.id,
        size: node.size,
        width: { kind: "hug" },
        height: { kind: "hug" },
        rotation: 0,
        verticalAlign: "top",
        position: { x: 0, y: rect().height * 3 },
      });
    });
    await editor.settle();
    editor.history.capture("Select", () => editor.selection.select([other.id]));
    const start = sceneRect(editor, other.id);
    const nudge = editor.hitRadius / 2;
    const grab = { x: start.x + 10, y: start.y + start.height / 2 };

    await editor.dragScene({
      down: grab,
      start: { x: grab.x + 4, y: grab.y },
      end: { x: grab.x + 200 + nudge, y: grab.y },
    });
    // Its left edge left the other box's left edge behind, and found nothing within reach.
    expect(sceneRect(editor, other.id).x).toBeCloseTo(start.x + 200 + nudge);

    const moved = sceneRect(editor, other.id);
    await editor.dragScene({
      down: { x: moved.x + 10, y: grab.y },
      start: { x: moved.x + 6, y: grab.y },
      end: { x: moved.x + 10 - moved.x - nudge, y: grab.y },
    });
    expect(sceneRect(editor, other.id).x).toBeCloseTo(rect().x);
  });

  it("copies, cuts, and pastes as boxes with their text and size", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    expect(await editor.copy()).toBe(true);
    expect(await editor.paste()).toBe(true);

    const pasted = editor.scene.nodesOfKind("textRun").find((other) => other.id !== node.id);
    expect(pasted).toMatchObject({ size: node.size, width: node.width, rotation: 0 });
    expect(editor.text.items(pasted!).length).toBe(editor.text.items(node).length);
    expect(pasted!.runId).not.toBe(node.runId);
    expect(editor.selection.ids).toEqual([pasted!.id]);

    expect(await editor.cut()).toBe(true);
    expect(editor.scene.nodesOfKind("textRun")).toHaveLength(1);
    await editor.undo();
    expect(editor.scene.nodesOfKind("textRun")).toHaveLength(2);
  });

  it("deletes a selected box and its run", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    await editor.deleteSelection();

    expect(editor.scene.node(node.id)).toBeNull();
    expect(editor.text.run(node.runId)).toBeNull();
  });

  it("fixes the width and wraps when its right edge is dragged, and hugs again on double-click", async () => {
    editor.history.capture("Select", () => editor.selection.select([node.id]));
    const before = rect();
    const edge = { x: before.right, y: before.y + before.height / 2 };

    await dragScene(edge, -before.width * 0.3);

    expect(box(editor, node.id).width.kind).toBe("fixed");
    expect(lines(editor, node.id)).toBe(2);

    const after = rect();
    await clickScene({ x: after.right, y: after.y + after.height / 2 });
    await clickScene({ x: after.right, y: after.y + after.height / 2 });
    expect(box(editor, node.id).width).toEqual({ kind: "hug" });
  });
});

describe("the Text tool places text boxes", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().startSession();
    editor.pages.activate(editor.pages.create().id);
    editor.selectTool("text");
  });

  const boxes = () => editor.scene.nodesOfKind("textRun");

  it("draws a box of the dragged width, whose lines wrap", async () => {
    await editor.dragScene({
      down: { x: 100, y: 50 },
      start: { x: 110, y: 50 },
      end: { x: 600, y: 50 },
    });

    expect(boxes()).toHaveLength(1);
    expect(boxes()[0]).toMatchObject({
      position: { x: 100, y: 50 },
      width: { kind: "fixed", size: 500 },
      height: { kind: "hug" },
    });
    expect(editor.textEditing.state?.nodeId).toBe(boxes()[0]!.id);
  });

  it("fixes the height too when the drag goes down at least an em", async () => {
    const em = editor.font.metricsCell.peek().unitsPerEm;
    await editor.dragScene({
      down: { x: 100, y: 50 },
      start: { x: 110, y: 60 },
      end: { x: 600, y: 50 + em * 2 },
    });

    expect(boxes()[0]).toMatchObject({
      width: { kind: "fixed", size: 500 },
      height: { kind: "fixed", size: em * 2 },
    });
  });

  it("starts a new box at the size last used", async () => {
    await editor.dragScene({
      down: { x: 100, y: 50 },
      start: { x: 110, y: 50 },
      end: { x: 600, y: 50 },
    });
    editor.textEditing.insertText("A");
    editor.text.setSize(boxes()[0]!.id, 24);

    const screen = editor.sceneToScreen(scenePoint(100, 4000));
    await editor.click(screen.x, screen.y);

    const placed = boxes().find((other) => other.id === editor.textEditing.state?.nodeId);
    expect(placed?.size).toBe(24);
  });

  it("blinks the caret while typing, shown again on every change", async () => {
    const screen = editor.sceneToScreen(scenePoint(100, 50));
    await editor.click(screen.x, screen.y);
    vi.useFakeTimers();
    try {
      const shown = editor.textEditing.caretShownCell;
      editor.textEditing.insertText("A");
      expect(shown.peek()).toBe(true);
      vi.advanceTimersByTime(600);
      expect(shown.peek()).toBe(false);

      editor.textEditing.insertText("A");
      expect(shown.peek()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes a placed box left empty", async () => {
    const screen = editor.sceneToScreen(scenePoint(100, 50));
    await editor.click(screen.x, screen.y);
    expect(boxes()).toHaveLength(1);

    editor.selectTool("select");
    expect(boxes()).toHaveLength(0);
  });

  it("selects the box it leaves on Escape", async () => {
    const screen = editor.sceneToScreen(scenePoint(100, 50));
    await editor.click(screen.x, screen.y);
    editor.textEditing.insertText("A");

    editor.escape();
    expect(editor.selection.ids).toEqual([boxes()[0]!.id]);
  });
});
