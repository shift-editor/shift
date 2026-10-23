import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import { TestEditor } from "@/testing/TestEditor";
import { attachStubSurfaces, createStubCanvas } from "@/testing/stubCanvas";

const FONT = resolve(process.cwd(), "../../fixtures/fonts/AnchorDragBench.glyphs");

interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One rectangle the background layer filled or outlined, in device pixels. */
interface PaintedRect {
  readonly kind: "fill" | "stroke";
  readonly rect: ScreenRect;
  /** The outline's width in device pixels; zero for a fill. */
  readonly widthPx: number;
}

/** What the background layer painted in one frame: rectangles and text labels. */
interface PaintedFrame {
  readonly rects: PaintedRect[];
  readonly labels: string[];
}

/**
 * Records what the background layer paints in its latest frame: rectangles,
 * mapped through the canvas transform however the layer draws them, and text.
 */
function recordBackground(editor: TestEditor): () => PaintedFrame {
  const frames: PaintedFrame[] = [];
  const ctx = createStubCanvas().ctx;
  const stack: Mat[] = [];
  let matrix = Mat.Identity();
  let path: ScreenRect[] = [];
  const toDevice = (x: number, y: number, width: number, height: number): ScreenRect => {
    const a = Mat.applyToPoint(matrix, { x, y });
    const b = Mat.applyToPoint(matrix, { x: x + width, y: y + height });
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  };
  const devicePx = (width: number) =>
    width * Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
  const paint = (kind: PaintedRect["kind"], rect: ScreenRect) =>
    frames
      .at(-1)
      ?.rects.push({ kind, rect, widthPx: kind === "stroke" ? devicePx(ctx.lineWidth) : 0 });

  // The renderer clears a layer at the start of each frame it draws.
  ctx.clearRect = () => frames.push({ rects: [], labels: [] });
  ctx.fillText = (text) => frames.at(-1)?.labels.push(text);
  ctx.save = () => stack.push(matrix.clone());
  ctx.restore = () => {
    matrix = stack.pop() ?? matrix;
  };
  ctx.transform = (a, b, c, d, e, f) => {
    matrix = matrix.clone().multiply(new Mat(a, b, c, d, e, f));
  };
  ctx.setTransform = ((a: number, b: number, c: number, d: number, e: number, f: number) => {
    matrix = new Mat(a, b, c, d, e, f);
  }) as typeof ctx.setTransform;
  ctx.resetTransform = () => {
    matrix = Mat.Identity();
  };
  ctx.beginPath = () => {
    path = [];
  };
  ctx.rect = (x, y, width, height) => path.push(toDevice(x, y, width, height));
  ctx.stroke = (() => path.forEach((rect) => paint("stroke", rect))) as typeof ctx.stroke;
  ctx.fillRect = (x, y, width, height) => paint("fill", toDevice(x, y, width, height));
  ctx.strokeRect = (x, y, width, height) => paint("stroke", toDevice(x, y, width, height));
  attachStubSurfaces(editor, { background: ctx });
  return () => frames.at(-1) ?? { rects: [], labels: [] };
}

describe("frames draw no box of their own", () => {
  it("paints nothing behind their children, and names only the frames on the page", async () => {
    const editor = await new TestEditor().openSession(FONT, "u");
    editor.exitNodes();
    const outer = editor.frames.create(null, { position: { x: 3000, y: 0 }, name: "Outer" })!;
    editor.frames.create(outer.id, { name: "Inner" });
    await editor.settle();
    const latest = recordBackground(editor);

    editor.setZoom(0.5);
    await expect.poll(() => latest().labels).toEqual(["Outer"]);
    expect(latest().rects).toEqual([]);
  });
});
