import type { Point2D } from "@shift/geo";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { GlyphCatalogOverlay } from "./GlyphCatalogOverlay";
import { CanvasSurface } from "@/lib/editor/rendering/CanvasSurface";
import { FrameHandler } from "@/lib/editor/rendering/FrameHandler";
import { parseCssColor } from "@/lib/editor/rendering/markers/color";
import { ResidentGlyphLayer } from "@/lib/graphics/backends/ResidentGlyphLayer";
import type {
  GlyphCatalogControllerFrame,
  GlyphCatalogFrame,
  GlyphCatalogItem,
  GridReadiness,
} from "@/types/glyphCatalog";
import type { GlyphPreviewInstance } from "@/types/glyphPreview";
import type { CatalogGlyphKey, GlyphAtlasPageRequest, GlyphAtlasSource } from "@/types/glyphAtlas";

const ATLAS_PAGE_ROOT_COUNT = 256;
const SLUG_ATLAS_PROFILING_ENABLED =
  new URLSearchParams(window.location.search).get("shiftProfileSlugAtlas") === "1";

/** Owns catalog DOM events, complete atlas replacement, and frame scheduling. */
export class GlyphCatalogController {
  readonly #container: HTMLDivElement;
  readonly #glyphCanvas: HTMLCanvasElement;
  readonly #atlasSource: GlyphAtlasSource;
  readonly #onEditGlyph: ((glyph: GlyphCatalogItem) => void) | null;
  readonly #onEditingUnavailable: () => void;
  readonly #openGlyph: ((glyph: GlyphCatalogItem) => Promise<void>) | null;
  readonly #onReadyChange: (ready: boolean) => void;
  readonly #onUnavailable: () => void;
  readonly #overlay: GlyphCatalogOverlay;
  readonly #frames = new FrameHandler();
  readonly #resizeObserver: ResizeObserver;
  readonly #unobserveAtlas: () => void;
  readonly #invalidGlyphIds = new Set<CatalogGlyphKey>();
  readonly #replacementPageIndices = new Set<number>();
  readonly #pageIndexByGlyph = new Map<CatalogGlyphKey, number>();

  #targetFrame: GlyphCatalogControllerFrame | null = null;
  #activeFrame: GlyphCatalogControllerFrame | null = null;
  #fontGlyphIds: readonly CatalogGlyphKey[] = [];
  #layer: ResidentGlyphLayer | null = null;
  /** Device initialization; aborted work retains this slot until it settles. */
  #refresh: AbortController | null = null;
  /** One complete current-revision page-set replacement. */
  #atlasBuild: AbortController | null = null;
  #pointer: Point2D | null = null;
  #hoveredCatalogIndex: number | null = null;
  #firstFrameStarted = false;
  #weightRevision = 0;
  #needsRedraw = true;
  #disposed = false;

  constructor(
    container: HTMLDivElement,
    glyphCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    atlasSource: GlyphAtlasSource,
    observeAtlasInvalidation: (
      listener: (
        glyphKeys: readonly CatalogGlyphKey[] | null,
        directory: readonly CatalogGlyphKey[],
      ) => void,
    ) => () => void,
    onEditGlyph: ((glyph: GlyphCatalogItem) => void) | null,
    onEditingUnavailable: () => void,
    openGlyph: ((glyph: GlyphCatalogItem) => Promise<void>) | null,
    onReadyChange: (ready: boolean) => void,
    onUnavailable: () => void,
  ) {
    this.#container = container;
    this.#glyphCanvas = glyphCanvas;
    this.#atlasSource = atlasSource;
    this.#onEditGlyph = onEditGlyph;
    this.#onEditingUnavailable = onEditingUnavailable;
    this.#openGlyph = openGlyph;
    this.#onReadyChange = onReadyChange;
    this.#onUnavailable = onUnavailable;
    this.#overlay = new GlyphCatalogOverlay(overlayCanvas);
    this.#glyphCanvas.dataset.fullyResident = "false";
    this.#glyphCanvas.dataset.gridReadiness = "Initial" satisfies GridReadiness;

    this.#resizeObserver = new ResizeObserver(() => {
      this.#needsRedraw = true;
      this.redraw();
    });
    this.#resizeObserver.observe(container);
    container.addEventListener("scroll", this.#handleScroll, { passive: true });
    container.addEventListener("pointermove", this.#handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", this.#handlePointerLeave);
    container.addEventListener("click", this.#handleClick);
    document.fonts.addEventListener("loadingdone", this.#handleFontsLoaded);
    void this.#redrawWhenFontsReady();

    this.#unobserveAtlas = observeAtlasInvalidation((glyphKeys, directory) => {
      this.#invalidate(glyphKeys, directory);
    });
    this.#startLayer();
  }

  update(frame: GlyphCatalogControllerFrame, inputContainer: HTMLDivElement | null): void {
    const previousTarget = this.#targetFrame;
    this.#targetFrame = frame;

    if (
      !previousTarget ||
      previousTarget.glyphs !== frame.glyphs ||
      !sameCoordinates(previousTarget.location, frame.location) ||
      previousTarget.metrics !== frame.metrics ||
      previousTarget.sourceId !== frame.sourceId ||
      previousTarget.themeName !== frame.themeName
    ) {
      this.#needsRedraw = true;
    }

    const locationChanged = !sameCoordinates(previousTarget?.location ?? null, frame.location);
    if (this.#layer && !this.#atlasBuild && this.#invalidGlyphIds.size === 0) {
      if (locationChanged) {
        void this.#refreshResolvedWeights(frame);
      } else {
        this.#activeFrame = frame;
        this.#updateResidency();
      }
    }

    this.#overlay.setInputContainer(inputContainer);
    if (!frame.active) {
      this.#frames.cancelUpdate();
      this.#pointer = null;
      this.#updateHoveredCatalogIndex(null);
      return;
    }

    if (!this.#layer) this.#startLayer();
    void this.#refreshAtlas();
    this.redraw();
  }

  redraw(): void {
    if (this.#disposed || !this.#targetFrame?.active) return;
    this.#frames.requestUpdate(() => this.#draw());
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unobserveAtlas();
    this.#refresh?.abort(new Error("glyph catalog disposed"));
    this.#atlasBuild?.abort(new Error("glyph catalog disposed"));
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

  #invalidate(
    glyphIds: readonly CatalogGlyphKey[] | null,
    fontGlyphIds: readonly CatalogGlyphKey[],
  ): void {
    const directoryChanged = !sameGlyphIds(this.#fontGlyphIds, fontGlyphIds);
    this.#fontGlyphIds = fontGlyphIds;
    if (directoryChanged) {
      this.#pageIndexByGlyph.clear();
      for (let glyphIndex = 0; glyphIndex < fontGlyphIds.length; glyphIndex += 1) {
        this.#pageIndexByGlyph.set(
          fontGlyphIds[glyphIndex]!,
          Math.floor(glyphIndex / ATLAS_PAGE_ROOT_COUNT),
        );
      }
    }

    const invalidateAll = glyphIds === null || directoryChanged;
    if (invalidateAll) {
      this.#invalidGlyphIds.clear();
      for (const glyphId of fontGlyphIds) this.#invalidGlyphIds.add(glyphId);
    } else {
      for (const glyphId of glyphIds) {
        if (this.#pageIndexByGlyph.has(glyphId)) this.#invalidGlyphIds.add(glyphId);
      }
    }

    this.#replacementPageIndices.clear();
    if (invalidateAll) {
      for (let pageIndex = 0; pageIndex < this.#pageCount(); pageIndex += 1) {
        this.#replacementPageIndices.add(pageIndex);
      }
    } else {
      for (const glyphId of this.#invalidGlyphIds) {
        const pageIndex = this.#pageIndex(glyphId);
        if (pageIndex !== null) this.#replacementPageIndices.add(pageIndex);
      }
    }

    this.#atlasBuild?.abort(new Error("resident atlas revision changed"));
    this.#needsRedraw = true;
    this.#updateResidency();

    if (this.#targetFrame?.active) void this.#refreshAtlas();
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
        this.#atlasSource,
        (reason) => this.#handleDeviceLoss(reason),
        refresh.signal,
      );
      if (this.#disposed || this.#refresh !== refresh) {
        layer.destroy();
        return;
      }

      this.#layer = layer;
      this.#refresh = null;
      this.#needsRedraw = true;
      this.#updateResidency();
      await this.#refreshAtlas();
    } catch (error) {
      if (this.#disposed || this.#refresh !== refresh) return;
      this.#refresh = null;
      if (refresh.signal.aborted) {
        if (this.#targetFrame?.active) this.#startLayer();
        return;
      }
      console.error("resident glyph initialization failed", error);
      this.#glyphCanvas.dataset.gridReadiness = "Unavailable" satisfies GridReadiness;
      this.#onUnavailable();
    }
  }

  async #refreshAtlas(): Promise<void> {
    if (this.#disposed || !this.#targetFrame?.active || this.#refresh || this.#atlasBuild) return;
    const layer = this.#layer;
    if (!layer) {
      this.#startLayer();
      return;
    }

    const pageRequests = this.#pageRequests();
    if (pageRequests.length === 0) {
      this.#activeFrame = this.#targetFrame;
      this.#updateResidency();
      this.#needsRedraw = true;
      this.redraw();
      return;
    }

    const atlasBuild = new AbortController();
    this.#atlasBuild = atlasBuild;
    this.#updateResidency();

    try {
      await layer.loadPages(pageRequests, atlasBuild.signal);
      if (this.#disposed || this.#atlasBuild !== atlasBuild || atlasBuild.signal.aborted) return;

      for (const request of pageRequests) {
        this.#replacementPageIndices.delete(request.pageIndex);
        for (const glyphId of request.glyphKeys) this.#invalidGlyphIds.delete(glyphId);
      }
      await this.#synchronizeResolvedWeights(layer);
      if (this.#disposed || this.#atlasBuild !== atlasBuild || atlasBuild.signal.aborted) return;
      this.#activeFrame = this.#targetFrame;
      this.#needsRedraw = true;
      this.#updateResidency();
      this.redraw();
    } catch (error) {
      if (!atlasBuild.signal.aborted) this.#handleReplacementFailure(error);
    } finally {
      if (this.#atlasBuild === atlasBuild) this.#atlasBuild = null;
    }

    if (atlasBuild.signal.aborted) void this.#refreshAtlas();
  }

  async #refreshResolvedWeights(frame: GlyphCatalogControllerFrame): Promise<void> {
    const layer = this.#layer;
    const coordinates = frame.location;
    if (!layer || this.#atlasBuild) return;
    const revision = ++this.#weightRevision;

    try {
      await layer.updateResolvedWeights(coordinates);
      if (
        this.#disposed ||
        this.#layer !== layer ||
        revision !== this.#weightRevision ||
        !sameCoordinates(this.#targetFrame?.location ?? null, coordinates)
      ) {
        return;
      }

      this.#activeFrame = this.#targetFrame;
      this.#needsRedraw = true;
      this.#updateResidency();
      this.redraw();
    } catch (error) {
      if (revision === this.#weightRevision) this.#handleReplacementFailure(error);
    }
  }

  async #synchronizeResolvedWeights(layer: ResidentGlyphLayer): Promise<void> {
    while (true) {
      const coordinates = this.#targetFrame?.location;
      if (!coordinates) return;

      await layer.updateResolvedWeights(coordinates);
      if (sameCoordinates(this.#targetFrame?.location ?? null, coordinates)) return;
    }
  }

  #pageRequests(): GlyphAtlasPageRequest[] {
    return [...this.#replacementPageIndices]
      .sort((left, right) => left - right)
      .map((pageIndex) => this.#pageRequest(pageIndex));
  }

  #pageRequest(pageIndex: number): GlyphAtlasPageRequest {
    const start = pageIndex * ATLAS_PAGE_ROOT_COUNT;
    return {
      glyphKeys: this.#fontGlyphIds.slice(start, start + ATLAS_PAGE_ROOT_COUNT),
      pageIndex,
      pageCount: this.#pageCount(),
      replacementPageIndices: [...this.#replacementPageIndices].sort((left, right) => left - right),
      coordinates: this.#targetFrame?.location ?? [],
    };
  }

  #pageIndex(glyphId: CatalogGlyphKey): number | null {
    return this.#pageIndexByGlyph.get(glyphId) ?? null;
  }

  #pageCount(): number {
    return Math.ceil(this.#fontGlyphIds.length / ATLAS_PAGE_ROOT_COUNT);
  }

  #handleDeviceLoss(reason: string): void {
    if (this.#disposed) return;
    console.error("resident glyph device lost", reason);
    this.#refresh?.abort(new Error(reason));
    this.#atlasBuild?.abort(new Error(reason));
    this.#refresh = null;
    this.#atlasBuild = null;
    this.#layer = null;
    this.#activeFrame = null;
    this.#invalidGlyphIds.clear();
    for (const glyphId of this.#fontGlyphIds) this.#invalidGlyphIds.add(glyphId);
    this.#replacementPageIndices.clear();
    for (let pageIndex = 0; pageIndex < this.#pageCount(); pageIndex += 1) {
      this.#replacementPageIndices.add(pageIndex);
    }
    this.#glyphCanvas.dataset.fullyResident = "false";
    this.#glyphCanvas.dataset.gridReadiness = "Unavailable" satisfies GridReadiness;
    this.#firstFrameStarted = false;
    this.#needsRedraw = true;
    this.#onReadyChange(false);
    this.#onUnavailable();
  }

  #layout(frame = this.#activeFrame ?? this.#targetFrame): GlyphCatalogLayout {
    return new GlyphCatalogLayout(
      this.#container.clientWidth,
      this.#container.clientHeight,
      frame?.glyphs.length ?? 0,
    );
  }

  #currentFrame(
    layout = this.#layout(),
    input = this.#activeFrame ?? this.#targetFrame,
  ): GlyphCatalogFrame {
    return layout.frame(input?.glyphs ?? [], this.#container.scrollTop);
  }

  #draw(): void {
    if (this.#disposed) return;
    const input = this.#activeFrame;
    if (!input?.active) return;

    const ratio = window.devicePixelRatio;
    const previousWidth = this.#glyphCanvas.width;
    const previousHeight = this.#glyphCanvas.height;
    CanvasSurface.resize(this.#glyphCanvas, ratio);
    if (this.#glyphCanvas.width !== previousWidth || this.#glyphCanvas.height !== previousHeight) {
      this.#needsRedraw = true;
    }

    const layout = this.#layout(input);
    const frame = this.#currentFrame(layout, input);
    const hoveredCell = this.#pointer ? layout.hit(frame, this.#pointer) : null;
    this.#updateHoveredCatalogIndex(hoveredCell?.catalogIndex ?? null);
    this.#overlay.draw(this.#container, frame, hoveredCell?.catalogIndex ?? null);

    if (input.editingGlyphId && !this.#overlay.positionInput(frame, input.editingGlyphId)) {
      this.#onEditingUnavailable();
    }

    const layer = this.#layer;
    if (!layer) return;
    const visibleGlyphIds = frame.cells.map((cell) => cell.glyph.id);
    if (!layer.hasGlyphs(visibleGlyphIds)) {
      void this.#refreshAtlas();
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
        const [viewHeight, metricsTop] = GlyphPreviewLayout.fontViewport(input.metrics);
        layer.draw({
          location: input.location,
          instances,
          style: {
            defaultPixelsPerEm: (frame.layout.previewHeight * ratio) / Math.max(1, viewHeight),
            metricsTop,
            metricsBottom: metricsTop - viewHeight,
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
      this.#handleReplacementFailure(error);
    }
  }

  async #completeFirstFrame(layer: ResidentGlyphLayer): Promise<void> {
    try {
      const started = performance.now();
      await layer.complete();
      if (this.#disposed || this.#layer !== layer || !this.#activeFrame) return;
      const visibleGlyphIds = this.#currentFrame().cells.map((cell) => cell.glyph.id);
      if (!layer.hasGlyphs(visibleGlyphIds)) return;

      if (SLUG_ATLAS_PROFILING_ENABLED) {
        console.info("[slug-atlas-profile]", {
          boundary: "renderer",
          phase: "first-frame-gpu-complete",
          durationMs: performance.now() - started,
          visibleGlyphCount: visibleGlyphIds.length,
        });
      }
      this.#onReadyChange(true);
    } catch (error) {
      if (this.#disposed || this.#layer !== layer) return;
      this.#handleReplacementFailure(error);
    }
  }

  #handleReplacementFailure(error: unknown): void {
    console.error("resident glyph replacement failed", error);
    this.#needsRedraw = true;
    if (this.#activeFrame) {
      this.#updateResidency();
      this.redraw();
      return;
    }

    this.#glyphCanvas.dataset.gridReadiness = "Unavailable" satisfies GridReadiness;
    this.#onReadyChange(false);
    this.#onUnavailable();
  }

  #updateResidency(): void {
    const layer = this.#layer;
    const complete =
      Boolean(layer) &&
      Boolean(this.#activeFrame) &&
      this.#invalidGlyphIds.size === 0 &&
      this.#replacementPageIndices.size === 0;
    const residentGlyphCount = layer ? this.#fontGlyphIds.length - this.#invalidGlyphIds.size : 0;
    this.#glyphCanvas.dataset.fullyResident = String(complete);
    this.#glyphCanvas.dataset.residentGlyphCount = String(residentGlyphCount);
    this.#glyphCanvas.dataset.targetGlyphCount = String(this.#fontGlyphIds.length);
    const activeLayout = this.#activeFrame ? this.#layout(this.#activeFrame) : null;
    this.#glyphCanvas.dataset.previewHeight = String(activeLayout?.previewHeight ?? 0);

    let readiness: GridReadiness = "Initial";
    if (this.#activeFrame) readiness = complete ? "Complete" : "Stale";
    this.#glyphCanvas.dataset.gridReadiness = readiness;
  }

  #updateHoveredCatalogIndex(nextIndex: number | null): void {
    if (this.#hoveredCatalogIndex === nextIndex) return;
    this.#hoveredCatalogIndex = nextIndex;
    const interactive = this.#onEditGlyph !== null || this.#openGlyph !== null;
    this.#container.style.cursor = nextIndex === null || !interactive ? "" : "pointer";
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
    const input = this.#activeFrame;
    if (!input) return;

    const layout = this.#layout(input);
    const frame = this.#currentFrame(layout, input);
    const point = CanvasSurface.localPoint(this.#container, {
      x: event.clientX,
      y: event.clientY,
    });
    const nameCell = layout.hit(frame, point, "name");
    if (nameCell && this.#onEditGlyph) {
      this.#activeFrame = { ...input, editingGlyphId: nameCell.glyph.id };
      this.#onEditGlyph(nameCell.glyph);
      return;
    }

    const previewCell = layout.hit(frame, point, "preview");
    if (!previewCell || !this.#openGlyph) return;
    void this.#open(previewCell.glyph);
  };

  async #open(glyph: GlyphCatalogItem): Promise<void> {
    const openGlyph = this.#openGlyph;
    if (!openGlyph) return;

    try {
      await openGlyph(glyph);
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

function sameGlyphIds(
  left: readonly CatalogGlyphKey[],
  right: readonly CatalogGlyphKey[],
): boolean {
  return left.length === right.length && left.every((glyphId, index) => glyphId === right[index]);
}

function sameCoordinates(left: readonly number[] | null, right: readonly number[] | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
