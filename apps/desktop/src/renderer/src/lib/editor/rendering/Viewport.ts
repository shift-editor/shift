import type { Point2D } from "@shift/types";
import type { Theme } from "./Theme";
import { DEFAULT_THEME } from "./Theme";
import { Canvas } from "./Canvas";
import { FrameHandler } from "./FrameHandler";
import { FpsMonitor } from "./FpsMonitor";
import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";
import type { Editor } from "../Editor";

/**
 * Parameters that position and scale the UPM coordinate system onto the screen.
 */
export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
  centre: Point2D;
  upmScale: number;
  logicalHeight: number;
  padding: number;
  descender: number;
}

/**
 * Manages canvas layers, viewport transforms, and RAF scheduling.
 * Does NOT decide what to draw — Editor owns the render pipeline.
 *
 * Four stacked HTML canvas elements (CSS composited):
 * - background (2D)
 * - scene (2D)
 * - handles (WebGL)
 * - overlay (2D)
 */
export class Viewport {
  #layers: {
    background: CanvasRenderingContext2D | null;
    scene: CanvasRenderingContext2D | null;
    overlay: CanvasRenderingContext2D | null;
  } = { background: null, scene: null, overlay: null };

  #canvases: {
    background: Canvas | null;
    scene: Canvas | null;
    overlay: Canvas | null;
  } = { background: null, scene: null, overlay: null };

  #gpuHandleContext: ReglHandleContext | null = null;

  #backgroundFrame = new FrameHandler();
  #sceneFrame = new FrameHandler();
  #overlayFrame = new FrameHandler();

  #fpsMonitor = new FpsMonitor();
  #theme: Theme = DEFAULT_THEME;
  #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  get fpsMonitor(): FpsMonitor {
    return this.#fpsMonitor;
  }

  setBackgroundContext(ctx: CanvasRenderingContext2D): void {
    this.#layers.background = ctx;
    this.#canvases.background = null;
  }

  setSceneContext(ctx: CanvasRenderingContext2D): void {
    this.#layers.scene = ctx;
    this.#canvases.scene = null;
  }

  setOverlayContext(ctx: CanvasRenderingContext2D): void {
    this.#layers.overlay = ctx;
    this.#canvases.overlay = null;
  }

  setGpuHandleContext(context: ReglHandleContext): void {
    this.#gpuHandleContext = context;
  }

  get gpuHandleContext(): ReglHandleContext | null {
    return this.#gpuHandleContext;
  }

  requestBackgroundRedraw(): void {
    this.#backgroundFrame.requestUpdate(() => this.#renderBackground());
  }

  requestSceneRedraw(): void {
    this.#sceneFrame.requestUpdate(() => this.#renderScene());
  }

  requestOverlayRedraw(): void {
    this.#overlayFrame.requestUpdate(() => this.#renderOverlay());
  }

  requestRedraw(): void {
    this.requestBackgroundRedraw();
    this.requestSceneRedraw();
    this.requestOverlayRedraw();
  }

  requestImmediateRedraw(): void {
    this.#renderBackground();
    this.#renderScene();
    this.#renderOverlay();
  }

  cancelRedraw(): void {
    this.#backgroundFrame.cancelUpdate();
    this.#sceneFrame.cancelUpdate();
    this.#overlayFrame.cancelUpdate();
  }

  #renderBackground(): void {
    const canvas = this.#getCanvas("background");
    if (!canvas) return;
    this.#beginUpmSpace(canvas);
    this.#editor.renderToolBackground(canvas);
    canvas.ctx.restore();
  }

  #renderScene(): void {
    const canvas = this.#getCanvas("scene");
    if (!canvas) return;
    this.#beginUpmSpace(canvas);
    this.#editor.renderToolScene(canvas);
    canvas.ctx.restore();
  }

  #renderOverlay(): void {
    const canvas = this.#getCanvas("overlay");
    if (!canvas) return;
    this.#editor.renderOverlay(canvas);
  }

  #getCanvas(layer: "background" | "scene" | "overlay"): Canvas | null {
    const ctx = this.#layers[layer];
    if (!ctx) return null;

    const vt = this.#editor.getViewportTransform();
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);

    let canvas = this.#canvases[layer];
    if (!canvas || canvas.ctx !== ctx) {
      canvas = new Canvas(ctx, vt, this.#theme);
      this.#canvases[layer] = canvas;
    } else {
      canvas.viewport = vt;
    }
    return canvas;
  }

  /** Set up UPM-space transform on the canvas context. Caller must restore(). */
  #beginUpmSpace(canvas: Canvas): void {
    const ctx = canvas.ctx;
    const vt = canvas.viewport;
    ctx.save();
    ctx.transform(
      vt.zoom,
      0,
      0,
      vt.zoom,
      vt.panX + vt.centre.x * (1 - vt.zoom),
      vt.panY + vt.centre.y * (1 - vt.zoom),
    );
    const baselineY = vt.logicalHeight - vt.padding - vt.descender * vt.upmScale;
    ctx.transform(vt.upmScale, 0, 0, -vt.upmScale, vt.padding, baselineY);
    const { x, y } = this.#editor.getDrawOffset();
    ctx.translate(x, y);
  }

  /** Enter UPM space on the given canvas. Public for overlay two-pass rendering. */
  beginUpmSpace(canvas: Canvas): void {
    this.#beginUpmSpace(canvas);
  }

  destroy(): void {
    this.#gpuHandleContext?.destroy();
    this.#backgroundFrame.cancelUpdate();
    this.#sceneFrame.cancelUpdate();
    this.#overlayFrame.cancelUpdate();
  }
}
