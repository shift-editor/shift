import type { Theme } from "./Theme";
import { DEFAULT_THEME } from "./Theme";
import { Canvas } from "./Canvas";
import { FrameHandler } from "./FrameHandler";
import { FpsMonitor } from "./FpsMonitor";
import { MarkerLayer } from "@/lib/graphics/backends/MarkerLayer";
import type { Editor } from "../Editor";
import type { Canvas2DSurface, MarkerCanvasSurface } from "./CanvasSurface";
import { effect, signal, track, type Effect, type WritableSignal } from "@/lib/signals/signal";
import { BackgroundLayer, OverlayLayer, SceneLayer } from "./RenderFrame";

type RenderLayer = "background" | "scene" | "overlay";

/**
 * Manages canvas layers, camera transforms, and RAF scheduling.
 * Does NOT decide what to draw — Editor owns the render pipeline.
 *
 * Four stacked HTML canvas elements (CSS composited):
 * - background (2D)
 * - scene (2D)
 * - markers (WebGL)
 * - overlay (2D)
 */
export class Renderer {
  #canvases: {
    background: Canvas | null;
    scene: Canvas | null;
    overlay: Canvas | null;
  } = { background: null, scene: null, overlay: null };

  #surface: Record<RenderLayer, WritableSignal<Canvas2DSurface | null>> = {
    background: signal<Canvas2DSurface | null>(null, {
      name: "renderer.surface.background",
    }),
    scene: signal<Canvas2DSurface | null>(null, {
      name: "renderer.surface.scene",
    }),
    overlay: signal<Canvas2DSurface | null>(null, {
      name: "renderer.surface.overlay",
    }),
  };
  #markerSurface = signal<MarkerCanvasSurface | null>(null, {
    name: "renderer.surface.markers",
  });

  #markerLayer = new MarkerLayer();

  #backgroundFrame = new FrameHandler();
  #sceneFrame = new FrameHandler();
  #overlayFrame = new FrameHandler();

  #backgroundEffect: Effect | null = null;
  #sceneEffect: Effect | null = null;
  #overlayEffect: Effect | null = null;

  #fpsMonitor = new FpsMonitor();
  #theme: Theme = DEFAULT_THEME;
  #editor: Editor;
  #backgroundLayer: BackgroundLayer;
  #sceneLayer: SceneLayer;
  #overlayLayer: OverlayLayer;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#backgroundLayer = new BackgroundLayer(editor);
    this.#sceneLayer = new SceneLayer(editor);
    this.#overlayLayer = new OverlayLayer(editor);
    this.#sceneLayer.setMarkerLayer(this.#markerLayer);

    this.#backgroundEffect = effect(
      () => {
        // traceReactiveRun();
        track(this.#surface.background);
        this.#renderBackground();
      },
      {
        name: "render.background",
        schedule: (execute) => this.#backgroundFrame.requestUpdate(execute),
      },
    );

    this.#sceneEffect = effect(
      () => {
        // traceReactiveRun();
        track(this.#surface.scene);
        track(this.#markerSurface);
        this.#renderScene();
      },
      {
        name: "render.scene",
        schedule: (execute) => this.#sceneFrame.requestUpdate(execute),
      },
    );

    this.#overlayEffect = effect(
      () => {
        // traceReactiveRun();
        track(this.#surface.overlay);
        this.#renderOverlay();
      },
      {
        name: "render.overlay",
        schedule: (execute) => this.#overlayFrame.requestUpdate(execute),
      },
    );
  }

  get fpsMonitor(): FpsMonitor {
    return this.#fpsMonitor;
  }

  setBackgroundSurface(surface: Canvas2DSurface): void {
    this.#surface.background.set(surface);
    this.#canvases.background = null;
    this.#renderBackground();
  }

  setSceneSurface(surface: Canvas2DSurface): void {
    this.#surface.scene.set(surface);
    this.#canvases.scene = null;
    this.#renderScene();
  }

  setOverlaySurface(surface: Canvas2DSurface): void {
    this.#surface.overlay.set(surface);
    this.#canvases.overlay = null;
    this.#renderOverlay();
  }

  setMarkerSurface(surface: MarkerCanvasSurface): void {
    this.#markerSurface.set(surface);
    this.#markerLayer.resizeCanvas(surface.canvas);
  }

  clearMarkerCanvas(): void {
    this.#markerSurface.set(null);
    this.#markerLayer.destroy();
    this.#markerLayer = new MarkerLayer();
    this.#sceneLayer.setMarkerLayer(this.#markerLayer);
  }

  get markerLayer(): MarkerLayer {
    return this.#markerLayer;
  }

  #renderBackground(): void {
    const canvas = this.#getCanvas("background");
    if (!canvas) return;

    canvas.withGlyphSpace({ x: 0, y: 0 }, () => {
      this.#backgroundLayer.draw(canvas);
    });
  }

  #renderScene(): void {
    const canvas = this.#getCanvas("scene");
    if (!canvas) return;

    canvas.withGlyphSpace({ x: 0, y: 0 }, () => {
      this.#sceneLayer.draw(canvas);
    });
  }

  #renderOverlay(): void {
    const canvas = this.#getCanvas("overlay");
    if (!canvas) return;

    canvas.withGlyphSpace({ x: 0, y: 0 }, () => {
      this.#overlayLayer.draw(canvas);
    });
  }

  #getCanvas(layer: "background" | "scene" | "overlay"): Canvas | null {
    const surface = this.#surface[layer].peek();
    if (!surface) return null;

    const camera = this.#editor.getCameraTransform();
    const { ctx, width, height } = surface;

    ctx.clearRect(0, 0, width, height);

    let canvas = this.#canvases[layer];
    if (!canvas || canvas.ctx !== ctx) {
      canvas = new Canvas(ctx, camera, this.#theme);
      this.#canvases[layer] = canvas;
    } else {
      canvas.camera = camera;
    }
    return canvas;
  }

  destroy(): void {
    this.#backgroundEffect?.dispose();
    this.#sceneEffect?.dispose();
    this.#overlayEffect?.dispose();
    this.#markerLayer.destroy();
    this.#backgroundFrame.cancelUpdate();
    this.#sceneFrame.cancelUpdate();
    this.#overlayFrame.cancelUpdate();
  }
}
