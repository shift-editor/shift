import type { Point2D } from "@shift/geo";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { GlyphCatalogOverlay } from "./GlyphCatalogOverlay";
import type { Font } from "@/lib/model/Font";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { effect, track, type Effect } from "@/lib/signals";
import { CanvasSurface } from "@/lib/editor/rendering/CanvasSurface";
import { FrameHandler } from "@/lib/editor/rendering/FrameHandler";
import { parseCssColor } from "@/lib/editor/rendering/markers/color";
import { ResidentGlyphLayer } from "@/lib/graphics/backends/ResidentGlyphLayer";
import type {
  GlyphCatalogControllerFrame,
  GlyphCatalogFrame,
  GlyphCatalogItem,
} from "@/types/glyphCatalog";
import type { GlyphPreviewInstance } from "@/types/glyphPreview";

/** Owns catalog DOM events, frame scheduling, layout, and resident rendering. */
export class GlyphCatalogController {
  readonly #container: HTMLDivElement;
  readonly #glyphCanvas: HTMLCanvasElement;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #onEditGlyph: (glyph: GlyphCatalogItem) => void;
  readonly #onEditingUnavailable: () => void;
  readonly #openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  readonly #onReadyChange: (ready: boolean) => void;
  readonly #onUnavailable: () => void;
  readonly #overlay: GlyphCatalogOverlay;
  readonly #frames = new FrameHandler();
  readonly #resizeObserver: ResizeObserver;
  readonly #fontEffect: Effect;

  #frame: GlyphCatalogControllerFrame | null = null;
  #layer: ResidentGlyphLayer | null = null;
  #load: AbortController | null = null;
  #pointer: Point2D | null = null;
  #hoveredCatalogIndex: number | null = null;
  #firstFrameStarted = false;
  #disposed = false;

  constructor(
    container: HTMLDivElement,
    glyphCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    font: Font,
    onEditGlyph: (glyph: GlyphCatalogItem) => void,
    onEditingUnavailable: () => void,
    openGlyph: (glyph: GlyphCatalogItem) => Promise<void>,
    onReadyChange: (ready: boolean) => void,
    onUnavailable: () => void,
  ) {
    this.#container = container;
    this.#glyphCanvas = glyphCanvas;
    this.#edits = font.editCoordinator;
    this.#onEditGlyph = onEditGlyph;
    this.#onEditingUnavailable = onEditingUnavailable;
    this.#openGlyph = openGlyph;
    this.#onReadyChange = onReadyChange;
    this.#onUnavailable = onUnavailable;
    this.#overlay = new GlyphCatalogOverlay(overlayCanvas);

    this.#resizeObserver = new ResizeObserver(() => this.redraw());
    this.#resizeObserver.observe(container);
    container.addEventListener("scroll", this.#handleScroll, { passive: true });
    container.addEventListener("pointermove", this.#handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", this.#handlePointerLeave, { passive: true });
    container.addEventListener("click", this.#handleClick);
    document.fonts.addEventListener("loadingdone", this.#handleFontsLoaded);
    void this.#redrawWhenFontsReady();

    this.#fontEffect = effect(
      () => {
        track(font.committedFontCell);
        this.#reload();
      },
      { name: "glyphCatalog.residentFont" },
    );
  }

  update(frame: GlyphCatalogControllerFrame, inputContainer: HTMLDivElement | null): void {
    this.#frame = frame;
    this.#overlay.setInputContainer(inputContainer);
    this.#glyphCanvas.style.visibility = frame.visible ? "visible" : "hidden";
    this.redraw();
  }

  redraw(): void {
    if (this.#disposed) return;
    this.#frames.requestUpdate(() => this.#draw());
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#fontEffect.dispose();
    this.#load?.abort(new Error("glyph catalog disposed"));
    this.#layer?.destroy();
    this.#layer = null;
    this.#frames.cancelUpdate();
    this.#resizeObserver.disconnect();
    this.#container.removeEventListener("scroll", this.#handleScroll);
    this.#container.removeEventListener("pointermove", this.#handlePointerMove);
    this.#container.removeEventListener("pointerleave", this.#handlePointerLeave);
    this.#container.removeEventListener("click", this.#handleClick);
    this.#container.style.cursor = "";
    document.fonts.removeEventListener("loadingdone", this.#handleFontsLoaded);
  }

  #reload(): void {
    this.#load?.abort(new Error("resident font changed"));
    this.#layer?.destroy();
    this.#layer = null;
    this.#firstFrameStarted = false;
    this.#onReadyChange(false);
    const load = new AbortController();
    this.#load = load;
    void this.#loadLayer(load);
  }

  async #loadLayer(load: AbortController): Promise<void> {
    try {
      const layer = await ResidentGlyphLayer.create(
        this.#glyphCanvas,
        this.#edits,
        (reason) => this.#handleDeviceLoss(load, reason),
        load.signal,
      );
      if (this.#disposed || this.#load !== load) {
        layer.destroy();
        return;
      }

      this.#layer = layer;
      this.redraw();
    } catch (error) {
      if (this.#disposed || this.#load !== load || load.signal.aborted) return;
      console.error("resident glyph initialization failed", error);
      this.#onUnavailable();
    }
  }

  #handleDeviceLoss(load: AbortController, reason: string): void {
    if (this.#disposed || this.#load !== load) return;
    console.error("resident glyph device lost", reason);
    this.#layer = null;
    this.#firstFrameStarted = false;
    this.#onReadyChange(false);
    this.#onUnavailable();
  }

  #layout(): GlyphCatalogLayout {
    return new GlyphCatalogLayout(
      this.#container.clientWidth,
      this.#container.clientHeight,
      this.#frame?.glyphs.length ?? 0,
    );
  }

  #currentFrame(layout = this.#layout()): GlyphCatalogFrame {
    return layout.frame(this.#frame?.glyphs ?? [], this.#container.scrollTop);
  }

  #draw(): void {
    if (this.#disposed) return;
    const input = this.#frame;
    if (!input) return;

    const ratio = window.devicePixelRatio;
    CanvasSurface.resize(this.#glyphCanvas, ratio);
    const layout = this.#layout();
    const frame = this.#currentFrame(layout);
    const hoveredCell = this.#pointer ? layout.hit(frame, this.#pointer) : null;
    this.#updateHoveredCatalogIndex(hoveredCell?.catalogIndex ?? null);
    this.#overlay.draw(this.#container, frame, hoveredCell?.catalogIndex ?? null);

    if (input.editingGlyphId && !this.#overlay.positionInput(frame, input.editingGlyphId)) {
      this.#onEditingUnavailable();
    }

    const layer = this.#layer;
    if (!layer) return;

    try {
      const instances: GlyphPreviewInstance[] = frame.cells.map((cell) => ({
        glyphId: cell.glyph.id,
        sourceId: input.sourceId,
        pixelRect: [
          cell.previewContentRect.left * ratio,
          cell.previewContentRect.top * ratio,
          cell.previewContentRect.right * ratio,
          cell.previewContentRect.bottom * ratio,
        ],
      }));
      const catalogIntersectsViewport =
        frame.layout.totalHeight > frame.scrollTop &&
        frame.scrollTop + frame.layout.viewportHeight > 0;

      if (instances.length > 0 || input.glyphs.length === 0 || !catalogIntersectsViewport) {
        const [viewHeight, fontTop] = GlyphPreviewLayout.fontViewport(input.metrics);
        layer.draw({
          location: input.location,
          axes: input.axes,
          instances,
          style: {
            viewHeight,
            fontTop,
            previewHeight: frame.layout.previewHeight * ratio,
            sideMargin: GlyphPreviewLayout.sideMargin(input.metrics),
            color: parseCssColor(getComputedStyle(this.#container).color),
          },
          viewportWidth: this.#glyphCanvas.width,
          viewportHeight: this.#glyphCanvas.height,
        });
      }

      if (!this.#firstFrameStarted && instances.length > 0) {
        this.#firstFrameStarted = true;
        void this.#completeFirstFrame(layer);
      }
    } catch (error) {
      this.#failFrame(layer, error);
    }
  }

  async #completeFirstFrame(layer: ResidentGlyphLayer): Promise<void> {
    try {
      await layer.complete();
      if (this.#disposed || this.#layer !== layer) return;
      this.#onReadyChange(true);
    } catch (error) {
      if (this.#disposed || this.#layer !== layer) return;
      this.#failFrame(layer, error);
    }
  }

  #failFrame(layer: ResidentGlyphLayer, error: unknown): void {
    console.error("resident glyph frame failed", error);
    layer.destroy();
    if (this.#layer === layer) this.#layer = null;
    this.#firstFrameStarted = false;
    this.#onReadyChange(false);
    this.#onUnavailable();
  }

  #updateHoveredCatalogIndex(nextIndex: number | null): void {
    if (this.#hoveredCatalogIndex === nextIndex) return;
    this.#hoveredCatalogIndex = nextIndex;
    this.#container.style.cursor = nextIndex === null ? "" : "pointer";
  }

  #handleScroll = (): void => this.redraw();

  #handlePointerMove = (event: PointerEvent): void => {
    this.#pointer = CanvasSurface.localPoint(this.#container, {
      x: event.clientX,
      y: event.clientY,
    });
    this.redraw();
  };

  #handlePointerLeave = (): void => {
    this.#pointer = null;
    this.#updateHoveredCatalogIndex(null);
    this.redraw();
  };

  #handleClick = (event: MouseEvent): void => {
    const layout = this.#layout();
    const frame = this.#currentFrame(layout);
    const point = CanvasSurface.localPoint(this.#container, {
      x: event.clientX,
      y: event.clientY,
    });
    const nameCell = layout.hit(frame, point, "name");
    if (nameCell) {
      if (this.#frame) {
        this.#frame = { ...this.#frame, editingGlyphId: nameCell.glyph.id };
      }
      this.#onEditGlyph(nameCell.glyph);
      return;
    }

    const previewCell = layout.hit(frame, point, "preview");
    if (!previewCell) return;
    void this.#open(previewCell.glyph);
  };

  async #open(glyph: GlyphCatalogItem): Promise<void> {
    try {
      await this.#openGlyph(glyph);
    } catch (error) {
      console.error("failed to open catalog Glyph", error);
    }
  }

  #handleFontsLoaded = (): void => this.redraw();

  async #redrawWhenFontsReady(): Promise<void> {
    try {
      await document.fonts.ready;
      this.redraw();
    } catch (error) {
      console.error("failed to await catalog fonts", error);
    }
  }
}
