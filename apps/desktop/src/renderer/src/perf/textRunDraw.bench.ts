import { resolve } from "node:path";
import { bench, describe } from "vitest";
import type { AnchorId, GlyphName, TextItemId } from "@shift/types";
import { PositionEdits } from "@shift/editor/model";
import type { LocalPoint } from "@shift/editor/spaces";
import { TestEditor } from "@/testing/TestEditor";
import { createStubCanvas } from "@/testing/stubCanvas";
import { proofText } from "@/testing/proofText";

/**
 * Redraw cost of a long proof run, per frame.
 *
 * @remarks
 * Real editor and renderer effects (background, scene, overlay) drawing into
 * stub 2D contexts. Animation frames are run by hand, so each iteration's
 * redraw happens synchronously inside the timed function. The run is lorem in
 * `fixtures/fonts/AnchorDragBench.glyphs` with every 4th letter `ǖ` and every
 * 13th another composite on `u`.
 *
 * - **hover** changes the hovered item and redraws, with no geometry edit.
 * - **pointer hit test** finds the run glyph under a point, as every pointer move does.
 * - **drag u.top** previews a move of the edited `u`'s `top` anchor and redraws.
 *
 * Scales default to 1K and 10K characters so `pnpm test:perf` stays quick;
 * set `SHIFT_BENCH_TEXT_RUN_SCALES=1000,10000,100000` for the large run.
 */

const FONT = resolve(process.cwd(), "../../fixtures/fonts/AnchorDragBench.glyphs");
const SCALES = (process.env.SHIFT_BENCH_TEXT_RUN_SCALES ?? "1000,10000")
  .split(",")
  .map((scale) => Number(scale.trim()));
const OPTIONS = { time: 0, iterations: 60, warmupTime: 0, warmupIterations: 5 };

// Hand-run animation frames: render effects schedule here and run in `flushFrames`.
let frameQueue: Array<() => void> = [];
let nextFrameId = 0;
globalThis.requestAnimationFrame = ((callback: () => void) => {
  frameQueue.push(callback);
  return ++nextFrameId;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = () => {};

/** Runs queued frames, and frames they queue, like the browser would before painting. */
function flushFrames(): number {
  let ran = 0;
  for (let guard = 0; frameQueue.length > 0 && guard < 10; guard++) {
    const queue = frameQueue;
    frameQueue = [];
    for (const callback of queue) {
      ran++;
      callback();
    }
  }
  return ran;
}

function stubSurfaces() {
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
    ctx: createStubCanvas().ctx,
    width: 1000,
    height: 800,
  });
  return {
    background: surface(),
    scene: surface(),
    overlay: surface(),
    markers: { canvas: element(), rect, dpr: 1, width: 1000, height: 800 },
  };
}

interface Proof {
  editor: TestEditor;
  itemIds: readonly TextItemId[];
}

/** Opens the fixture at `u`, edits it in place, and fills the run with `count` characters. */
async function openProof(count: number): Promise<Proof> {
  const editor = await new TestEditor().openSession(FONT, "u");
  for (const record of editor.font.glyphRecords()) await editor.font.loadGlyph(record.id);
  const surfaces = stubSurfaces();
  editor.attachRenderSurfaces(
    surfaces.background as never,
    surfaces.scene as never,
    surfaces.overlay as never,
    surfaces.markers as never,
  );

  const run = editor.textRun!;
  const child = editor.runGlyph!;
  const edited = editor.text.run(run.runId)!.items.find((item) => item.id === child.itemId)!;
  editor.text.setItems(run.runId, [edited, ...editor.text.itemsFromText(proofText(count))]);
  await editor.settle();
  flushFrames();

  const layout = editor.text.layoutCell(run.runId).peek()!;
  const udieresismacron = editor.font.recordForName("udieresismacron" as GlyphName)!.id;
  if (!layout.placedGlyphs.some((placed) => placed.glyph.glyphId === udieresismacron)) {
    throw new Error("the proof run has no ǖ");
  }

  return { editor, itemIds: editor.text.run(run.runId)!.items.map((item) => item.id) };
}

/** The `u` glyph's `top` anchor in its default-source layer. */
function uTop(editor: TestEditor) {
  const u = editor.glyphForId(editor.font.recordForName("u" as GlyphName)!.id)!;
  const layer = u.layerForSource(editor.font.defaultSource.id)!;
  return layer.anchors.find((candidate) => candidate.name === "top")!;
}

for (const scale of SCALES) {
  describe(`text run redraw, ${scale.toLocaleString("en-US")} characters`, () => {
    let proof: Promise<Proof> | null = null;
    const open = () => (proof ??= openProof(scale));

    let hoverFrame = 0;
    bench(
      "hover (no edit)",
      async () => {
        const { editor, itemIds } = await open();
        editor.hover.set(itemIds[1 + (hoverFrame++ % (itemIds.length - 1))]!);
        if (flushFrames() === 0) throw new Error("hovering did not redraw");
      },
      {
        ...OPTIONS,
        setup: async () => {
          await open();
        },
        teardown: async () => {
          const { editor } = await open();
          editor.hover.clear();
          flushFrames();
        },
      },
    );

    // Every pointer move hit-tests the scene; over the run, past the edited glyph.
    bench(
      "pointer hit test",
      async () => {
        const { editor } = await open();
        const run = editor.textRun!;
        const placed = editor.text.layoutCell(run.runId).peek()!.placedGlyphs[2]!;
        // Between the bowl's outer and inner rings, inside the fill.
        const local = { x: placed.left + placed.glyph.xAdvance / 2, y: 35 } as LocalPoint;
        if (editor.getPointerTarget(editor.toScene(run, local)).kind !== "text") {
          throw new Error("the pointer is not over a run glyph");
        }
      },
      OPTIONS,
    );

    let move: ReturnType<PositionEdits["move"]> | null = null;
    let dragFrame = 0;
    bench(
      "drag u.top",
      async () => {
        dragFrame++;
        move!.preview({ x: dragFrame, y: dragFrame % 7 });
        if (flushFrames() === 0) throw new Error("dragging did not redraw");
      },
      {
        ...OPTIONS,
        setup: async () => {
          const { editor } = await open();
          const selection = editor.positionSelection([uTop(editor).id as AnchorId])!;
          move = PositionEdits.fromSelection(selection).move(selection.targets);
        },
        teardown: async (_task, mode) => {
          const { editor } = await open();
          const anchor = uTop(editor);
          const expected = { x: 250 + dragFrame, y: 500 + (dragFrame % 7) };
          if (anchor.x !== expected.x || anchor.y !== expected.y) {
            throw new Error(`u.top did not move: (${anchor.x}, ${anchor.y})`);
          }
          move!.discard();
          move = null;
          await editor.settle();
          flushFrames();
          if (mode === "run") await editor.closeSession();
        },
      },
    );
  });
}
