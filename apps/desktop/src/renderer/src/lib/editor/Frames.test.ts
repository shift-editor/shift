import { beforeEach, describe, expect, it } from "vitest";
import { Bounds, type Point2D } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type { FrameNode, ShiftNode, TextRunNode } from "@shift/editor/types";
import { scenePoint } from "@shift/editor/spaces";
import { TestEditor } from "@/testing/TestEditor";

const ORIGIN = { x: 2000, y: 0 };

function sceneRect(editor: TestEditor, node: ShiftNode) {
  const bounds = editor.nodeBounds(node);
  if (!bounds) throw new Error(`Expected bounds for ${node.kind}`);
  return Bounds.toRect(bounds);
}

function frame(editor: TestEditor, id: NodeId): FrameNode {
  const node = editor.scene.nodeOfKind(id, "frame");
  if (!node) throw new Error("Expected a frame");
  return node;
}

function addRun(editor: TestEditor, parentId: NodeId, text: string, size = 72): TextRunNode {
  const run = editor.frames.addText(parentId, text, { size });
  if (!run) throw new Error("Expected a run");
  return run;
}

async function addFrame(
  editor: TestEditor,
  parentId: NodeId | null,
  options: Parameters<TestEditor["frames"]["create"]>[1] = {},
): Promise<FrameNode> {
  const created = editor.frames.create(parentId, { position: ORIGIN, ...options });
  if (!created) throw new Error("Expected a frame");
  await editor.settle();
  return created;
}

describe("frames lay out their children in rows and columns", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().startSession();
  });

  it("stacks a column's runs with gap and padding", async () => {
    const column = await addFrame(editor, null, {
      layout: { gap: 24, padding: { top: 32, right: 32, bottom: 32, left: 32 } },
    });
    const first = sceneRect(editor, addRun(editor, column.id, "AA"));
    const second = sceneRect(editor, addRun(editor, column.id, "A", 36));
    await editor.settle();

    const box = sceneRect(editor, frame(editor, column.id));
    expect({ x: first.x, y: first.y }).toEqual({ x: 2032, y: 32 });
    expect(second.y).toBeCloseTo(first.bottom + 24);
    expect(box.width).toBeCloseTo(64 + Math.max(first.width, second.width));
    expect(box.height).toBeCloseTo(32 + first.height + 24 + second.height + 32);
  });

  it("places a row's runs side by side", async () => {
    const row = await addFrame(editor, null, {
      layout: { mode: "row", gap: 10, padding: { top: 5, right: 5, bottom: 5, left: 5 } },
    });
    const first = addRun(editor, row.id, "A");
    const second = addRun(editor, row.id, "A");
    await editor.settle();

    const a = sceneRect(editor, first);
    const b = sceneRect(editor, second);
    expect(a.x).toBeCloseTo(2005);
    expect(b.x).toBeCloseTo(a.right + 10);
    expect(b.y).toBeCloseTo(a.y);
  });

  it("keeps a fixed size and shares the rest between filling children", async () => {
    const row = await addFrame(editor, null, {
      layout: { mode: "row", gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      width: { kind: "fixed", size: 1000 },
    });
    const left = await addFrame(editor, row.id, { width: { kind: "fill" } });
    const right = await addFrame(editor, row.id, { width: { kind: "fill" } });

    expect(sceneRect(editor, frame(editor, row.id)).width).toBe(1000);
    expect(sceneRect(editor, left).width).toBeCloseTo(500);
    expect(sceneRect(editor, right).x).toBeCloseTo(2500);
  });

  it("hugs nested frames", async () => {
    const outer = await addFrame(editor, null);
    const inner = await addFrame(editor, outer.id);
    const run = sceneRect(editor, addRun(editor, inner.id, "A"));
    await editor.settle();

    const innerBox = sceneRect(editor, frame(editor, inner.id));
    const outerBox = sceneRect(editor, frame(editor, outer.id));
    expect(innerBox.width).toBeCloseTo(run.width + 32);
    expect(outerBox.width).toBeCloseTo(run.width + 64);
    expect(run.x).toBeCloseTo(2032);
  });

  it("relays out when a run's text changes", async () => {
    const column = await addFrame(editor, null);
    const run = addRun(editor, column.id, "A");
    await editor.settle();
    const before = sceneRect(editor, frame(editor, column.id)).width;

    editor.history.capture("Type", () =>
      editor.text.setItems(run.runId, editor.text.itemsFromText("AAA")),
    );
    await editor.settle();

    const runWidth = sceneRect(editor, run).width;
    expect(sceneRect(editor, frame(editor, column.id)).width).toBeCloseTo(runWidth + 32);
    expect(runWidth).toBeGreaterThan(before - 32);
  });

  it("lays out only the active page", async () => {
    const first = await addFrame(editor, null);
    const page = editor.pages.create();
    editor.pages.activate(page.id);
    const second = await addFrame(editor, page.id);

    expect(editor.frames.laidOut(second.id)).not.toBeNull();
    expect(editor.frames.laidOut(first.id)).toBeNull();
  });

  it("does not lay out again for selection, hover, or caret changes", async () => {
    const column = await addFrame(editor, null);
    const run = addRun(editor, column.id, "AA");
    await editor.settle();
    const layout = editor.frames.layoutCell.peek();

    editor.history.capture("Select", () => editor.selection.select([column.id]));
    editor.hover.set(column.id);
    editor.textEditing.resume(run.id, null);

    expect(editor.frames.layoutCell.peek()).toBe(layout);
  });
});

describe("editing frames is one undo step each", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = await new TestEditor().startSession();
  });

  it("creates and deletes a frame with its runs, and undoes both", async () => {
    const column = await addFrame(editor, null);
    const run = addRun(editor, column.id, "A");

    editor.frames.delete(column.id);
    expect(editor.scene.node(column.id)).toBeNull();
    expect(editor.text.run(run.runId)).toBeNull();

    await editor.undo();
    expect(editor.scene.node(column.id)).not.toBeNull();
    expect(editor.text.run(run.runId)).not.toBeNull();
  });

  it("wraps runs that share a parent at their place, keeping their order", async () => {
    const page = editor.pages.active!;
    const first = addRun(editor, page.id, "A");
    const second = addRun(editor, page.id, "A");
    await editor.settle();
    const corner = sceneRect(editor, first);

    const wrapped = editor.frames.wrap([second.id, first.id], "row");

    expect(wrapped?.position).toEqual({ x: corner.x, y: corner.y });
    expect(editor.scene.children(wrapped!.id).map((node) => node.id)).toEqual([
      first.id,
      second.id,
    ]);
    await editor.undo();
    expect(editor.scene.node(first.id)?.parentId).toBe(page.id);
    expect(editor.scene.node(wrapped!.id)).toBeNull();
  });

  it("changes layout, sizing, and child order", async () => {
    const column = await addFrame(editor, null);
    const first = addRun(editor, column.id, "A");
    const second = addRun(editor, column.id, "A");

    editor.frames.setLayout(column.id, { mode: "row", gap: 40 });
    editor.frames.setSizing(column.id, "width", { kind: "fixed", size: 900 });
    editor.frames.moveChild(second.id, 0);

    expect(frame(editor, column.id).layout).toMatchObject({ mode: "row", gap: 40 });
    expect(frame(editor, column.id).width).toEqual({ kind: "fixed", size: 900 });
    expect(editor.scene.children(column.id).map((node) => node.id)).toEqual([second.id, first.id]);
  });

  it("deletes the selected frame from the Delete command", async () => {
    const column = await addFrame(editor, null);
    editor.history.capture("Select", () => editor.selection.select([column.id]));

    expect(await editor.deleteSelection()).toBe(true);
    expect(editor.scene.node(column.id)).toBeNull();
  });
});

describe("a selected frame resizes from its transform box", () => {
  let editor: TestEditor;
  let column: FrameNode;

  beforeEach(async () => {
    editor = await new TestEditor().startSession();
    editor.history.withoutRecording(() => editor.exitNodes());
    column = await addFrame(editor, null, { layout: { align: "center" } });
    addRun(editor, column.id, "A");
    await editor.settle();
    editor.selectTool("select");
    editor.zoomToFit();
  });

  const box = () => sceneRect(editor, frame(editor, column.id));
  const middle = (rect: ReturnType<typeof box>, x: number) =>
    scenePoint(x, rect.y + rect.height / 2);
  const dragEdge = (from: Point2D, dx: number) =>
    editor.dragScene({
      down: from,
      start: { x: from.x + Math.sign(dx) * 4, y: from.y },
      end: { x: from.x + dx, y: from.y },
    });

  it("selects the frame when its empty area is clicked", async () => {
    const rect = box();
    const screen = editor.sceneToScreen(middle(rect, rect.x + 4));
    await editor.click(screen.x, screen.y);

    expect(editor.selection.ids).toEqual([column.id]);
  });

  it("fixes the width when the right edge is dragged and reflows the children", async () => {
    editor.history.capture("Select", () => editor.selection.select([column.id]));
    const before = box();
    const child = sceneRect(editor, editor.scene.children(column.id)[0]!);

    await dragEdge(middle(before, before.right), 100);

    expect(frame(editor, column.id).width).toEqual({ kind: "fixed", size: before.width + 100 });
    expect(box().x).toBeCloseTo(before.x);
    expect(sceneRect(editor, editor.scene.children(column.id)[0]!).x).toBeCloseTo(child.x + 50);
  });

  it("keeps the right edge in place when the left edge is dragged", async () => {
    editor.history.capture("Select", () => editor.selection.select([column.id]));
    const before = box();

    await dragEdge(middle(before, before.x), -100);

    expect(box().right).toBeCloseTo(before.right);
    expect(box().width).toBeCloseTo(before.width + 100);
  });

  it("hugs again when the edge is double-clicked", async () => {
    editor.history.capture("Select", () => editor.selection.select([column.id]));
    editor.frames.setSizing(column.id, "width", { kind: "fixed", size: 2000 });
    await editor.settle();
    const rect = box();
    const screen = editor.sceneToScreen(middle(rect, rect.right));

    await editor.click(screen.x, screen.y);
    await editor.click(screen.x, screen.y);

    expect(frame(editor, column.id).width).toEqual({ kind: "hug" });
  });

  it("undoes a resize drag in one step", async () => {
    editor.history.capture("Select", () => editor.selection.select([column.id]));
    const before = box();

    await dragEdge(middle(before, before.x), -100);
    await editor.undo();

    expect(frame(editor, column.id).width).toEqual({ kind: "hug" });
    expect(frame(editor, column.id).position).toEqual(ORIGIN);
  });
});
