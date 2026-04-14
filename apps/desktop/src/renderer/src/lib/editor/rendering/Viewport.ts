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
 * Does NOT decide what to draw — tools own their rendering.
 *
 * Four stacked HTML canvas elements (CSS composited):
 * - background (2D) → tool.renderBackground(canvas)
 * - scene (2D)      → tool.renderScene(canvas)
 * - handles (WebGL) → handles.draw()
 * - overlay (2D)    → tool.renderOverlay(canvas)
 */
export class Viewport {
  #layers: {
    background: CanvasRenderingContext2D | null;
    scene: CanvasRenderingContext2D | null;
    overlay: CanvasRenderingContext2D | null;
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
  }

  setSceneContext(ctx: CanvasRenderingContext2D): void {
    this.#layers.scene = ctx;
  }

  setOverlayContext(ctx: CanvasRenderingContext2D): void {
    this.#layers.overlay = ctx;
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
    const ctx = this.#layers.background;
    if (!ctx) return;
    this.#renderLayer(ctx, (canvas) => {
      this.#editor.renderToolBackground(canvas);
    });
  }

  #renderScene(): void {
    const ctx = this.#layers.scene;
    if (!ctx) return;
    this.#renderLayer(ctx, (canvas) => {
      this.#editor.renderToolScene(canvas);
    });
  }

  #renderOverlay(): void {
    const ctx = this.#layers.overlay;
    if (!ctx) return;
    this.#renderLayer(ctx, (canvas) => {
      this.#editor.renderToolOverlay(canvas);
    });
  }

  #renderLayer(ctx: CanvasRenderingContext2D, draw: (canvas: Canvas) => void): void {
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    this.#applyViewportTransform(ctx);
    const vt = this.#editor.getViewportTransform();
    const { x, y } = this.#editor.getDrawOffset();
    ctx.translate(x, y);
    draw(new Canvas(ctx, vt, this.#theme));
    ctx.restore();
  }

  #applyViewportTransform(ctx: CanvasRenderingContext2D): void {
    const vt = this.#editor.getViewportTransform();
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
  }

  destroy(): void {
    this.#gpuHandleContext?.destroy();
    this.#backgroundFrame.cancelUpdate();
    this.#sceneFrame.cancelUpdate();
    this.#overlayFrame.cancelUpdate();
  }
}
