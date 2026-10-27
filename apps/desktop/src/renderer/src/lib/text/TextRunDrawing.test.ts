import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GlyphName } from "@shift/types";
import type { GlyphRenderModel } from "@shift/editor/model";
import { TestEditor } from "@/testing/TestEditor";
import { createStubContext } from "@/testing/stubCanvas";

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
  const rect = { x: 0, y: 0, width: 1000, height: 800, left: 0, top: 0, right: 1000, bottom: 800 };
  const element = () =>
    ({
      width: 1000,
      height: 800,
      getBoundingClientRect: () => rect,
      getContext: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as HTMLCanvasElement;
  const surface = () => ({
    canvas: element(),
    rect,
    dpr: 1,
    ctx: createStubContext(),
    width: 1000,
    height: 800,
  });

  const frames: SceneFrame[] = [];
  const scene = surface();
  // The renderer clears a layer at the start of each frame it draws.
  scene.ctx.clearRect = () => frames.push({ fills: [], strokes: [] });
  scene.ctx.fill = ((path: Path2D) => frames.at(-1)?.fills.push(path)) as typeof scene.ctx.fill;
  scene.ctx.stroke = ((path?: Path2D) => {
    if (path) frames.at(-1)?.strokes.push(path);
  }) as typeof scene.ctx.stroke;
  editor.attachRenderSurfaces(
    surface() as never,
    scene as never,
    surface() as never,
    { canvas: element(), rect, dpr: 1, width: 1000, height: 800 } as never,
  );
  return () => frames.at(-1) ?? { fills: [], strokes: [] };
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
