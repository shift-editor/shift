import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Mat } from "@shift/geo";
import type { FrameNode } from "@shift/editor/types";
import { scenePoint } from "@shift/editor/spaces";
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

/**
 * Records the rectangles the background layer paints in its latest frame,
 * mapped through the canvas transform, however the layer draws them.
 */
function recordBackground(editor: TestEditor): () => readonly PaintedRect[] {
  const frames: PaintedRect[][] = [];
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
    frames.at(-1)?.push({ kind, rect, widthPx: kind === "stroke" ? devicePx(ctx.lineWidth) : 0 });

  // The renderer clears a layer at the start of each frame it draws.
  ctx.clearRect = () => frames.push([]);
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
  return () => frames.at(-1) ?? [];
}

/** A frame's laid-out box on screen, rounded so float noise between paths compares equal. */
function screenBox(editor: TestEditor, frame: FrameNode): ScreenRect {
  const bounds = editor.nodeBounds(editor.scene.node(frame.id)!)!;
  const a = editor.sceneToScreen(scenePoint(bounds.min.x, bounds.min.y));
  const b = editor.sceneToScreen(scenePoint(bounds.max.x, bounds.max.y));
  return rounded({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  });
}

function rounded(rect: ScreenRect): ScreenRect {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

describe("frames paint their boxes behind their children", () => {
  it("fills then outlines each frame's laid-out box in scene order, the outline one width at any zoom", async () => {
    const editor = await new TestEditor().openSession(FONT, "u");
    editor.exitNodes();
    const outer = editor.frames.create(null, { position: { x: 3000, y: 0 } })!;
    const inner = editor.frames.create(outer.id, {})!;
    editor.frames.addText(inner.id, "uu", { size: 72 });
    await editor.settle();
    const latest = recordBackground(editor);
    const painted = () =>
      latest().map(({ kind, rect, widthPx }) => ({ kind, rect: rounded(rect), widthPx }));
    const expected = () =>
      [outer, inner].flatMap((frame) => {
        const rect = screenBox(editor, frame);
        return [
          { kind: "fill", rect },
          { kind: "stroke", rect },
        ];
      });

    editor.setZoom(0.5);
    await expect
      .poll(() => painted().map(({ kind, rect }) => ({ kind, rect })))
      .toEqual(expected());
    const width = painted()[1]!.widthPx;
    editor.setZoom(0.25);
    await expect
      .poll(() => painted().map(({ kind, rect }) => ({ kind, rect })))
      .toEqual(expected());

    const strokeWidths = painted()
      .filter(({ kind }) => kind === "stroke")
      .map(({ widthPx }) => widthPx);
    expect(width).toBeGreaterThan(0);
    strokeWidths.forEach((stroke) => expect(stroke).toBeCloseTo(width));
  });
});
