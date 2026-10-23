import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import type { GlyphRenderModel } from "@shift/editor/model";
import type { TextRunNode } from "@shift/editor/types";
import { TestEditor } from "@/testing/TestEditor";
import { attachStubSurfaces, createStubCanvas } from "@/testing/stubCanvas";

const FONT = resolve(process.cwd(), "../../fixtures/fonts/AnchorDragBench.glyphs");

interface SceneFrame {
  readonly fills: Path2D[];
  readonly strokes: Path2D[];
}

/**
 * Attaches the real renderer to stub canvases and records the paths the
 * scene fills and strokes in each frame it draws.
 */
function recordSceneFrames(editor: TestEditor): () => SceneFrame {
  const frames: SceneFrame[] = [];
  const scene = createStubCanvas().ctx;
  // The renderer clears a layer at the start of each frame it draws.
  scene.clearRect = () => frames.push({ fills: [], strokes: [] });
  scene.fill = ((path: Path2D) => frames.at(-1)?.fills.push(path)) as typeof scene.fill;
  scene.stroke = ((path?: Path2D) => {
    if (path) frames.at(-1)?.strokes.push(path);
  }) as typeof scene.stroke;
  attachStubSurfaces(editor, { scene });
  return () => frames.at(-1) ?? { fills: [], strokes: [] };
}

interface RectCommand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The rectangles traced into a path, read from the test setup's Path2D stub. */
function rectsOf(path: Path2D): RectCommand[] {
  const { commands } = path as unknown as { commands: ({ type: string } & RectCommand)[] };
  return commands.filter((command) => command.type === "rect");
}

/** Places a run showing `text` on the active page at `x`, 72 units tall. */
function addRun(editor: TestEditor, text: string, x: number, y = 0): TextRunNode {
  return editor.scene.createNode<TextRunNode>({
    kind: "textRun",
    runId: editor.text.createRun(editor.text.itemsFromText(text)).id,
    size: 72,
    width: { kind: "hug" },
    height: { kind: "hug" },
    rotation: 0,
    verticalAlign: "top",
    position: { x, y },
  });
}

/** Records the paths the scene fills in its latest frame. */
function recordSceneFills(editor: TestEditor): () => readonly Path2D[] {
  const latest = recordSceneFrames(editor);
  return () => latest().fills;
}

describe("text run drawing", () => {
  let editor: TestEditor;

  const glyphId = (name: string) => editor.font.recordForName(name as GlyphName)!.id;
  const renderModel = (name: string): GlyphRenderModel | null =>
    editor
      .glyphForId(glyphId(name))
      ?.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell) ?? null;
  /** Fills of `model`'s closed contours in the latest scene frame. */
  const fillsOf = (fills: readonly Path2D[], model: GlyphRenderModel | null) =>
    model ? fills.filter((path) => path === model.closedContoursPath).length : 0;

  it("redraws every composite occurrence when an outline only the run draws changes", async () => {
    editor = await new TestEditor().openSession(FONT, "u");
    const run = editor.textRun!;
    const edited = editor.text.run(run.runId)!.items[0]!;
    editor.text.setItems(run.runId, [edited, ...editor.text.itemsFromText("ǖlǖü")]);
    const latestFills = recordSceneFills(editor);
    await expect.poll(() => fillsOf(latestFills(), renderModel("udieresismacron"))).toBe(2);

    const composite = renderModel("udieresismacron")!;
    const drawnBefore = composite.closedContoursPath;
    // The dieresis is a component of both composites and is not the edited glyph. A drag
    // preview commits nothing, so only the run's own subscriptions can redraw it.
    const dieresis = editor.glyphForId(glyphId("dieresiscomb"))!;
    const layer = dieresis.layerForSource(editor.font.defaultSource.id)!;
    const point = layer.allPoints[0]!;
    layer.previewPositionPatch([{ kind: "point", id: point.id, x: point.x + 25, y: point.y }]);

    await expect.poll(() => fillsOf(latestFills(), composite)).toBe(2);
    expect(composite.closedContoursPath).not.toBe(drawnBefore);
    expect(latestFills()).not.toContain(drawnBefore);
    const single = renderModel("udieresis")!;
    expect(fillsOf(latestFills(), single)).toBe(1);
  });

  it("draws every occurrence of a glyph that loads after the run first draws", async () => {
    editor = await new TestEditor().openSession(FONT, "u");
    expect(editor.glyphForId(glyphId("o"))).toBeNull();
    const latestFills = recordSceneFills(editor);

    const run = editor.textRun!;
    const edited = editor.text.run(run.runId)!.items[0]!;
    editor.text.setItems(run.runId, [edited, ...editor.text.itemsFromText("ouo")]);

    await expect.poll(() => fillsOf(latestFills(), renderModel("o"))).toBe(2);
  });

  it("fills every greeked run's line as a bar across the run, in one path for all runs", async () => {
    editor = await new TestEditor().openSession(FONT, "u");
    editor.exitNodes();
    const runs = [addRun(editor, "uu", 3000), addRun(editor, "u u u", 3000, -200)];
    await editor.settle();
    const latestFills = recordSceneFills(editor);
    // 72 units at this zoom is under two pixels per em, too small to read.
    editor.setZoom(0.02);

    const barPaths = () =>
      latestFills()
        .map(rectsOf)
        .filter((rects) => rects.length > 0);
    await expect.poll(() => barPaths().length).toBe(1);
    const boxes = runs.map((run) => editor.nodeBounds(editor.scene.node(run.id)!)!);
    expect(barPaths()[0]!.map((bar) => ({ left: bar.x, right: bar.x + bar.width }))).toEqual(
      boxes.map((box) => ({ left: box.min.x, right: box.max.x })),
    );
    barPaths()[0]!.forEach((bar, index) => {
      expect(bar.y).toBeGreaterThan(boxes[index]!.min.y);
      expect(bar.y + bar.height).toBeLessThan(boxes[index]!.max.y);
    });
  });

  it("moves a greeked run's bar with its text and its position while zoomed out", async () => {
    editor = await new TestEditor().openSession(FONT, "u");
    editor.exitNodes();
    const run = addRun(editor, "uu", 3000);
    await editor.settle();
    const latestFills = recordSceneFills(editor);
    editor.setZoom(0.02);
    const bar = () => latestFills().flatMap(rectsOf)[0] ?? null;
    const runEdges = () => {
      const box = editor.nodeBounds(editor.scene.node(run.id)!)!;
      return { left: box.min.x, right: box.max.x };
    };
    await expect.poll(bar).not.toBeNull();

    editor.text.setItems(run.runId, editor.text.itemsFromText("uuuu"));
    editor.scene.updateNode({ id: run.id, position: { x: 3500, y: 0 } });
    await editor.settle();

    await expect
      .poll(() => ({ left: bar()?.x, right: (bar()?.x ?? 0) + (bar()?.width ?? 0) }))
      .toEqual(runEdges());
    expect(runEdges().left).toBe(3500);
  });

  it("starts stroking a run glyph's open contour when one of its contours opens", async () => {
    editor = await new TestEditor().openSession(FONT, "u");
    const latestFrame = recordSceneFrames(editor);
    const run = editor.textRun!;
    const edited = editor.text.run(run.runId)!.items[0]!;
    editor.text.setItems(run.runId, [edited, ...editor.text.itemsFromText("ouo")]);
    await expect.poll(() => fillsOf(latestFrame().fills, renderModel("o"))).toBe(2);

    const o = renderModel("o")!;
    const strokesOfOpenPath = () =>
      latestFrame().strokes.filter((path) => path === o.openContoursPath).length;
    // Closed contours only: the run strokes nothing for it.
    expect(o.hasOpenContoursCell.peek()).toBe(false);
    expect(strokesOfOpenPath()).toBe(0);
    const layer = editor.glyphForId(glyphId("o"))!.layerForSource(editor.font.defaultSource.id)!;
    layer.openContour(layer.contours[0]!.id);
    await editor.settle();

    await expect.poll(strokesOfOpenPath).toBe(2);
  });
});
