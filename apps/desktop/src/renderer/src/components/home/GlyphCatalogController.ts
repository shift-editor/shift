import type { Point2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { GlyphCatalogOverlay } from "./GlyphCatalogOverlay";
import type { Font } from "@/lib/model/Font";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { effect, type Effect } from "@/lib/signals";
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
  readonly #invalidGlyphIds = new Set<GlyphId>();

  #frame: GlyphCatalogControllerFrame | null = null;
  #layer: ResidentGlyphLayer | null = null;
  /** Single native atlas operation; aborted work retains this slot until it actually settles. */
  #refresh: AbortController | null = null;
  #pointer: Point2D | null = null;
  #hoveredCatalogIndex: number | null = null;
  #firstFrameStarted = false;
  #needsRedraw = true;
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
    this.#glyphCanvas.dataset.fullyResident = "false";

    this.#resizeObserver = new ResizeObserver(() => this.redraw());
    this.#resizeObserver.observe(container);
    container.addEventListener("scroll", this.#handleScroll, { passive: true });
    container.addEventListener("pointermove", this.#handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", this.#handlePointerLeave, { passive: true });
    container.addEventListener("click", this.#handleClick);
    document.fonts.addEventListener("loadingdone", this.#handleFontsLoaded);
    void this.#redrawWhenFontsReady();

    this.#fontEffect = effect(
      () =>
        this.#invalidate(
          font.invalidGlyphIdsCell.value,
          font.glyphRecords().map((glyph) => glyph.id),
        ),
      { name: "glyphCatalog.residentFont" },
    );
    this.#startLayer();
  }

  update(frame: GlyphCatalogControllerFrame, inputContainer: HTMLDivElement | null): void {
    const previous = this.#frame;
    if (
      !previous ||
      previous.glyphs !== frame.glyphs ||
      previous.location !== frame.location ||
      previous.axes !== frame.axes ||
      previous.metrics !== frame.metrics ||
      previous.sourceId !== frame.sourceId ||
      previous.themeName !== frame.themeName
    ) {
      this.#needsRedraw = true;
    }

    if (previous?.active === false && frame.active) {
      this.#firstFrameStarted = false;
      this.#needsRedraw = true;
      this.#onReadyChange(false);
    }

    this.#frame = frame;
    if (previous?.glyphs !== frame.glyphs) this.#updateFullyResident();
    this.#overlay.setInputContainer(inputContainer);

    if (!frame.active) {
      this.#frames.cancelUpdate();
      this.#pointer = null;
      this.#updateHoveredCatalogIndex(null);
      return;
    }

    if (!this.#layer) this.#startLayer();
    void this.#refreshVisible();
    this.redraw();
  }

  redraw(): void {
    if (this.#disposed || !this.#frame?.active) return;
    this.#frames.requestUpdate(() => this.#draw());
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#fontEffect.dispose();
    this.#refresh?.abort(new Error("glyph catalog disposed"));
    this.#layer?.destroy();
    this.#layer = null;
    this.#frames.cancelUpdate();
    this.#glyphCanvas.dataset.fullyResident = "false";
    this.#resizeObserver.disconnect();
    this.#container.removeEventListener("scroll", this.#handleScroll);
    this.#container.removeEventListener("pointermove", this.#handlePointerMove);
    this.#container.removeEventListener("pointerleave", this.#handlePointerLeave);
    this.#container.removeEventListener("click", this.#handleClick);
    this.#container.style.cursor = "";
    document.fonts.removeEventListener("loadingdone", this.#handleFontsLoaded);
  }

  #invalidate(glyphIds: readonly GlyphId[] | null, fontGlyphIds: readonly GlyphId[]): void {
    if (glyphIds === null) {
      this.#invalidGlyphIds.clear();
      this.#refresh?.abort(new Error("resident font changed"));
      this.#layer?.destroy();
      this.#layer = null;
      this.#glyphCanvas.dataset.fullyResident = "false";
      this.#firstFrameStarted = false;
      this.#needsRedraw = true;
      this.#onReadyChange(false);

      if (this.#frame?.active) this.#startLayer();
      return;
    }
    if (glyphIds.length === 0) return;

    this.#layer?.invalidate(glyphIds);
    const fontGlyphIdSet = new Set(fontGlyphIds);
    for (const glyphId of glyphIds) {
      if (fontGlyphIdSet.has(glyphId)) this.#invalidGlyphIds.add(glyphId);
    }
    this.#updateFullyResident();
    this.#refresh?.abort(new Error("resident glyphs changed"));
    this.#firstFrameStarted = false;
    this.#needsRedraw = true;
    this.#onReadyChange(false);

    if (this.#frame?.active) void this.#refreshVisible();
  }

  #startLayer(): void {
    if (this.#disposed || this.#layer || this.#refresh) return;

    const refresh = new AbortController();
    this.#refresh = refresh;
    void this.#loadLayer(refresh);
  }

  async #loadLayer(refresh: AbortController): Promise<void> {
    try {
      const layer = await ResidentGlyphLayer.create(
        this.#glyphCanvas,
        this.#edits,
        (reason) => this.#handleDeviceLoss(reason),
        refresh.signal,
      );
      if (this.#disposed || this.#refresh !== refresh) {
        layer.destroy();
        return;
      }

      this.#layer = layer;
      this.#invalidGlyphIds.clear();
      this.#updateFullyResident();
      this.#refresh = null;
      this.#needsRedraw = true;
      this.#firstFrameStarted = false;
      this.redraw();
    } catch (error) {
      if (this.#disposed || this.#refresh !== refresh) return;
      this.#refresh = null;
      if (refresh.signal.aborted) {
        if (this.#frame?.active) this.#startLayer();
        return;
      }
      console.error("resident glyph initialization failed", error);
      this.#onUnavailable();
    }
  }

  async #refreshVisible(): Promise<void> {
    if (this.#disposed || !this.#frame?.active || this.#refresh) return;
    const layer = this.#layer;
    if (!layer) {
      this.#startLayer();
      return;
    }

    const missingGlyphIds = new Set(this.#invalidGlyphIds);
    for (const cell of this.#currentFrame().cells) {
      if (!layer.hasGlyphs([cell.glyph.id])) missingGlyphIds.add(cell.glyph.id);
    }
    if (missingGlyphIds.size === 0) {
      this.#updateFullyResident();
      this.redraw();
      return;
    }

    const glyphIds = [...missingGlyphIds];
    const refresh = new AbortController();
    this.#refresh = refresh;
    this.#onReadyChange(false);

    try {
      await layer.loadPatch(glyphIds, refresh.signal);
      if (this.#disposed || this.#refresh !== refresh) return;
      for (const glyphId of glyphIds) this.#invalidGlyphIds.delete(glyphId);
      this.#updateFullyResident();
      this.#refresh = null;
      this.#needsRedraw = true;
      this.#firstFrameStarted = false;
      this.redraw();
    } catch (error) {
      if (this.#disposed || this.#refresh !== refresh) return;
      this.#refresh = null;
      if (refresh.signal.aborted) {
        if (this.#frame?.active) void this.#refreshVisible();
        return;
      }
      this.#failFrame(layer, error);
    }
  }

  #handleDeviceLoss(reason: string): void {
    if (this.#disposed) return;
    console.error("resident glyph device lost", reason);
    this.#refresh?.abort(new Error(reason));
    this.#refresh = null;
    this.#layer = null;
    this.#glyphCanvas.dataset.fullyResident = "false";
    this.#firstFrameStarted = false;
    this.#needsRedraw = true;
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
    if (!input?.active) return;

    const ratio = window.devicePixelRatio;
    const previousWidth = this.#glyphCanvas.width;
    const previousHeight = this.#glyphCanvas.height;
    CanvasSurface.resize(this.#glyphCanvas, ratio);
    if (this.#glyphCanvas.width !== previousWidth || this.#glyphCanvas.height !== previousHeight) {
      this.#needsRedraw = true;
    }

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
    const visibleGlyphIds = frame.cells.map((cell) => cell.glyph.id);
    if (
      visibleGlyphIds.some((glyphId) => this.#invalidGlyphIds.has(glyphId)) ||
      !layer.hasGlyphs(visibleGlyphIds)
    ) {
      this.#firstFrameStarted = false;
      this.#onReadyChange(false);
      void this.#refreshVisible();
      return;
    }
    if (!this.#needsRedraw) return;

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
        this.#needsRedraw = false;
      }

      if (!this.#firstFrameStarted && instances.length > 0) {
        this.#firstFrameStarted = true;
        void this.#completeFirstFrame(layer);
      } else if (instances.length === 0) {
        this.#onReadyChange(true);
      }
    } catch (error) {
      this.#failFrame(layer, error);
    }
  }

  async #completeFirstFrame(layer: ResidentGlyphLayer): Promise<void> {
    try {
      await layer.complete();
      if (this.#disposed || this.#layer !== layer) return;
      const visibleGlyphIds = this.#currentFrame().cells.map((cell) => cell.glyph.id);
      if (
        visibleGlyphIds.some((glyphId) => this.#invalidGlyphIds.has(glyphId)) ||
        !layer.hasGlyphs(visibleGlyphIds)
      ) {
        return;
      }
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
    this.#glyphCanvas.dataset.fullyResident = "false";
    this.#refresh?.abort(new Error("resident glyph frame failed"));
    this.#refresh = null;
    this.#firstFrameStarted = false;
    this.#needsRedraw = true;
    this.#onReadyChange(false);
    this.#onUnavailable();
  }

  #updateFullyResident(): void {
    const layer = this.#layer;
    const glyphIds = this.#frame?.glyphs.map((glyph) => glyph.id) ?? [];
    const fullyResident =
      Boolean(layer) &&
      glyphIds.every((glyphId) => !this.#invalidGlyphIds.has(glyphId)) &&
      Boolean(layer?.hasGlyphs(glyphIds));
    this.#glyphCanvas.dataset.fullyResident = String(fullyResident);
  }

  #updateHoveredCatalogIndex(nextIndex: number | null): void {
    if (this.#hoveredCatalogIndex === nextIndex) return;
    this.#hoveredCatalogIndex = nextIndex;
    this.#container.style.cursor = nextIndex === null ? "" : "pointer";
  }

  #handleScroll = (): void => {
    this.#needsRedraw = true;
    this.redraw();
  };

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
