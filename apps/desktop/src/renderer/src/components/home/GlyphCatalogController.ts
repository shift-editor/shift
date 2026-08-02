import type { Point2D } from "@shift/geo";
import type { GlyphId, SlugPreviewExtents } from "@shift/types";
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
  GlyphCatalogAtlasPage,
  GlyphCatalogControllerFrame,
  GlyphCatalogFrame,
  GlyphCatalogItem,
  GridFrame,
  GridReadiness,
} from "@/types/glyphCatalog";
import type { GlyphPreviewInstance } from "@/types/glyphPreview";

const ATLAS_PAGE_ROOT_COUNT = 256;
const EMPTY_PREVIEW_EXTENTS: SlugPreviewExtents = {
  horizontal: 0,
  minimumY: 0,
  maximumY: 0,
};

/** Owns catalog DOM events, visible-first atlas replacement, and frame scheduling. */
export class GlyphCatalogController {
  readonly #container: HTMLDivElement;
  readonly #glyphCanvas: HTMLCanvasElement;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #onEditGlyph: (glyph: GlyphCatalogItem) => void;
  readonly #onEditingUnavailable: () => void;
  readonly #openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
  readonly #onReadyChange: (ready: boolean) => void;
  readonly #onUnavailable: () => void;
  readonly #onPreviewExtentsChange: (previewExtents: SlugPreviewExtents) => void;
  readonly #overlay: GlyphCatalogOverlay;
  readonly #frames = new FrameHandler();
  readonly #resizeObserver: ResizeObserver;
  readonly #fontEffect: Effect;
  readonly #invalidGlyphIds = new Set<GlyphId>();
  readonly #replacementPageIndices = new Set<number>();

  #targetFrame: GridFrame | null = null;
  #activeFrame: GridFrame | null = null;
  #fontGlyphIds: readonly GlyphId[] = [];
  #layer: ResidentGlyphLayer | null = null;
  /** Device initialization; aborted work retains this slot until it settles. */
  #refresh: AbortController | null = null;
  #visibleBuild: AbortController | null = null;
  #completeBuild: AbortController | null = null;
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
    onPreviewExtentsChange: (previewExtents: SlugPreviewExtents) => void,
  ) {
    this.#container = container;
    this.#glyphCanvas = glyphCanvas;
    this.#edits = font.editCoordinator;
    this.#onEditGlyph = onEditGlyph;
    this.#onEditingUnavailable = onEditingUnavailable;
    this.#openGlyph = openGlyph;
    this.#onReadyChange = onReadyChange;
    this.#onUnavailable = onUnavailable;
    this.#onPreviewExtentsChange = onPreviewExtentsChange;
    this.#overlay = new GlyphCatalogOverlay(overlayCanvas);
    this.#glyphCanvas.dataset.fullyResident = "false";
    this.#glyphCanvas.dataset.gridReadiness = "Initial" satisfies GridReadiness;

    this.#resizeObserver = new ResizeObserver(() => {
      this.#needsRedraw = true;
      void this.#refreshVisible();
      this.redraw();
    });
    this.#resizeObserver.observe(container);
    container.addEventListener("scroll", this.#handleScroll, { passive: true });
    container.addEventListener("pointermove", this.#handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", this.#handlePointerLeave);
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
    const previousTarget = this.#targetFrame;
    const previewExtents = previousTarget?.previewExtents ??
      this.#activeFrame?.previewExtents ?? { ...EMPTY_PREVIEW_EXTENTS };
    this.#targetFrame = { ...frame, previewExtents };

    if (
      !previousTarget ||
      previousTarget.glyphs !== frame.glyphs ||
      previousTarget.location !== frame.location ||
      previousTarget.axes !== frame.axes ||
      previousTarget.metrics !== frame.metrics ||
      previousTarget.sourceId !== frame.sourceId ||
      previousTarget.themeName !== frame.themeName
    ) {
      this.#needsRedraw = true;
    }

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
    if (this.#disposed || !this.#targetFrame?.active) return;
    this.#frames.requestUpdate(() => this.#draw());
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#fontEffect.dispose();
    this.#refresh?.abort(new Error("glyph catalog disposed"));
    this.#visibleBuild?.abort(new Error("glyph catalog disposed"));
    this.#completeBuild?.abort(new Error("glyph catalog disposed"));
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
    const directoryChanged = !sameGlyphIds(this.#fontGlyphIds, fontGlyphIds);
    this.#fontGlyphIds = fontGlyphIds;

    if (glyphIds === null || directoryChanged) {
      this.#invalidGlyphIds.clear();
      for (const glyphId of fontGlyphIds) this.#invalidGlyphIds.add(glyphId);
      if (this.#targetFrame) {
        this.#targetFrame = {
          ...this.#targetFrame,
          previewExtents: { ...EMPTY_PREVIEW_EXTENTS },
        };
      }
    } else {
      const fontGlyphIdSet = new Set(fontGlyphIds);
      for (const glyphId of glyphIds) {
        if (fontGlyphIdSet.has(glyphId)) this.#invalidGlyphIds.add(glyphId);
      }
    }

    this.#replacementPageIndices.clear();
    for (const glyphId of this.#invalidGlyphIds) {
      const pageIndex = this.#pageIndex(glyphId);
      if (pageIndex !== null) this.#replacementPageIndices.add(pageIndex);
    }

    this.#visibleBuild?.abort(new Error("resident visible frame changed"));
    this.#completeBuild?.abort(new Error("resident complete atlas changed"));
    this.#needsRedraw = true;
    this.#updateFullyResident();

    if (this.#targetFrame?.active) void this.#refreshVisible();
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
      this.#refresh = null;
      this.#needsRedraw = true;
      this.#updateFullyResident();
      await this.#refreshVisible();
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

  async #refreshVisible(): Promise<void> {
    if (this.#disposed || !this.#targetFrame?.active || this.#refresh) return;
    const layer = this.#layer;
    if (!layer) {
      this.#startLayer();
      return;
    }

    if (this.#visibleBuild) {
      this.#visibleBuild.abort(new Error("visible Grid frame superseded"));
      return;
    }
    if (this.#completeBuild) {
      this.#completeBuild.abort(new Error("visible Grid frame takes priority"));
      return;
    }

    const targetFrame = this.#targetFrame;
    const visibleGlyphIds = this.#currentFrame(this.#layout(targetFrame), targetFrame).cells.map(
      (cell) => cell.glyph.id,
    );
    const glyphIds = visibleGlyphIds.filter(
      (glyphId) => this.#invalidGlyphIds.has(glyphId) || !layer.hasGlyphs([glyphId]),
    );
    if (glyphIds.length === 0) {
      this.#activeFrame = targetFrame;
      this.#updateFullyResident();
      this.#needsRedraw = true;
      this.redraw();
      void this.#refreshComplete();
      return;
    }

    const visibleBuild = new AbortController();
    this.#visibleBuild = visibleBuild;
    this.#updateFullyResident();

    try {
      const pageRequests = this.#pageRequests(glyphIds);
      const pageExtents = await layer.loadPages(pageRequests, visibleBuild.signal);
      if (this.#disposed || this.#visibleBuild !== visibleBuild || visibleBuild.signal.aborted) {
        return;
      }

      const latestTarget = this.#targetFrame;
      if (!latestTarget) return;
      const targetExtents = mergePreviewExtents(latestTarget.previewExtents, pageExtents);
      const presentedExtents = mergePreviewExtents(
        this.#activeFrame?.previewExtents ?? EMPTY_PREVIEW_EXTENTS,
        targetExtents,
      );
      this.#targetFrame = { ...latestTarget, previewExtents: targetExtents };
      this.#activeFrame = { ...latestTarget, previewExtents: presentedExtents };
      for (const request of pageRequests) {
        for (const glyphId of request.glyphIds) this.#invalidGlyphIds.delete(glyphId);
      }
      this.#onPreviewExtentsChange(presentedExtents);
      this.#needsRedraw = true;
      this.#updateFullyResident();
      this.redraw();
    } catch (error) {
      if (!visibleBuild.signal.aborted) this.#handleReplacementFailure(error);
    } finally {
      if (this.#visibleBuild === visibleBuild) this.#visibleBuild = null;
    }

    if (visibleBuild.signal.aborted) {
      void this.#refreshVisible();
      return;
    }
    void this.#refreshComplete();
  }

  async #refreshComplete(): Promise<void> {
    if (
      this.#disposed ||
      !this.#targetFrame?.active ||
      !this.#layer ||
      this.#refresh ||
      this.#visibleBuild ||
      this.#completeBuild
    ) {
      return;
    }

    const targetFrame = this.#targetFrame;
    const visibleGlyphIds = this.#currentFrame(this.#layout(targetFrame), targetFrame).cells.map(
      (cell) => cell.glyph.id,
    );
    if (
      visibleGlyphIds.some(
        (glyphId) => this.#invalidGlyphIds.has(glyphId) || !this.#layer?.hasGlyphs([glyphId]),
      )
    ) {
      void this.#refreshVisible();
      return;
    }

    const completeBuild = new AbortController();
    this.#completeBuild = completeBuild;

    try {
      for (let start = 0; start < this.#fontGlyphIds.length; start += ATLAS_PAGE_ROOT_COUNT) {
        if (completeBuild.signal.aborted) break;

        const pageGlyphIds = this.#fontGlyphIds.slice(start, start + ATLAS_PAGE_ROOT_COUNT);
        const needsReplacement = pageGlyphIds.some(
          (glyphId) => this.#invalidGlyphIds.has(glyphId) || !this.#layer?.hasGlyphs([glyphId]),
        );
        if (!needsReplacement) continue;

        const pageIndex = start / ATLAS_PAGE_ROOT_COUNT;
        const pageExtents = await this.#layer.loadPages(
          [this.#pageRequest(pageIndex)],
          completeBuild.signal,
        );
        if (completeBuild.signal.aborted) break;

        const latestTarget = this.#targetFrame;
        if (!latestTarget) break;
        const targetExtents = mergePreviewExtents(latestTarget.previewExtents, pageExtents);
        const presentedExtents = mergePreviewExtents(
          this.#activeFrame?.previewExtents ?? EMPTY_PREVIEW_EXTENTS,
          targetExtents,
        );
        this.#targetFrame = { ...latestTarget, previewExtents: targetExtents };
        if (this.#activeFrame) {
          this.#activeFrame = { ...this.#activeFrame, previewExtents: presentedExtents };
        }
        for (const glyphId of pageGlyphIds) this.#invalidGlyphIds.delete(glyphId);
        this.#onPreviewExtentsChange(presentedExtents);
        this.#needsRedraw = true;
        this.#updateFullyResident();
        this.redraw();

        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (!completeBuild.signal.aborted) this.#handleReplacementFailure(error);
    } finally {
      if (this.#completeBuild === completeBuild) this.#completeBuild = null;
    }

    if (completeBuild.signal.aborted) void this.#refreshVisible();
  }

  #pageRequests(glyphIds: readonly GlyphId[]): GlyphCatalogAtlasPage[] {
    const pageIndices = new Set<number>();
    for (const glyphId of glyphIds) {
      const pageIndex = this.#pageIndex(glyphId);
      if (pageIndex !== null) pageIndices.add(pageIndex);
    }

    return [...pageIndices]
      .sort((left, right) => left - right)
      .map((pageIndex) => this.#pageRequest(pageIndex));
  }

  #pageRequest(pageIndex: number): GlyphCatalogAtlasPage {
    const start = pageIndex * ATLAS_PAGE_ROOT_COUNT;
    return {
      glyphIds: this.#fontGlyphIds.slice(start, start + ATLAS_PAGE_ROOT_COUNT),
      pageIndex,
      pageCount: this.#pageCount(),
      replacementPageIndices: [...this.#replacementPageIndices].sort((left, right) => left - right),
    };
  }

  #pageIndex(glyphId: GlyphId): number | null {
    const glyphIndex = this.#fontGlyphIds.indexOf(glyphId);
    return glyphIndex < 0 ? null : Math.floor(glyphIndex / ATLAS_PAGE_ROOT_COUNT);
  }

  #pageCount(): number {
    return Math.ceil(this.#fontGlyphIds.length / ATLAS_PAGE_ROOT_COUNT);
  }

  #handleDeviceLoss(reason: string): void {
    if (this.#disposed) return;
    console.error("resident glyph device lost", reason);
    this.#refresh?.abort(new Error(reason));
    this.#visibleBuild?.abort(new Error(reason));
    this.#completeBuild?.abort(new Error(reason));
    this.#refresh = null;
    this.#visibleBuild = null;
    this.#completeBuild = null;
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
    const metrics = frame?.metrics;
    return new GlyphCatalogLayout(
      this.#container.clientWidth,
      this.#container.clientHeight,
      frame?.glyphs.length ?? 0,
      metrics ?? fallbackMetrics(),
      frame?.previewExtents ?? EMPTY_PREVIEW_EXTENTS,
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
        const [viewHeight, fontTop] = GlyphPreviewLayout.fontViewport(
          input.metrics,
          input.previewExtents,
        );
        layer.draw({
          location: input.location,
          axes: input.axes,
          instances,
          style: {
            viewHeight,
            fontTop,
            previewHeight: frame.layout.previewHeight * ratio,
            sideMargin: GlyphPreviewLayout.sideMargin(input.metrics, input.previewExtents),
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
      await layer.complete();
      if (this.#disposed || this.#layer !== layer || !this.#activeFrame) return;
      const visibleGlyphIds = this.#currentFrame().cells.map((cell) => cell.glyph.id);
      if (!layer.hasGlyphs(visibleGlyphIds)) return;

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
      this.#updateFullyResident();
      this.redraw();
      return;
    }

    this.#glyphCanvas.dataset.gridReadiness = "Unavailable" satisfies GridReadiness;
    this.#onReadyChange(false);
    this.#onUnavailable();
  }

  #updateFullyResident(): void {
    const layer = this.#layer;
    const complete =
      Boolean(layer) &&
      this.#fontGlyphIds.every(
        (glyphId) => !this.#invalidGlyphIds.has(glyphId) && Boolean(layer?.hasGlyphs([glyphId])),
      );
    this.#glyphCanvas.dataset.fullyResident = String(complete);
    this.#glyphCanvas.dataset.residentGlyphCount = String(
      this.#fontGlyphIds.filter(
        (glyphId) => !this.#invalidGlyphIds.has(glyphId) && Boolean(layer?.hasGlyphs([glyphId])),
      ).length,
    );
    this.#glyphCanvas.dataset.targetGlyphCount = String(this.#fontGlyphIds.length);
    const activeLayout = this.#activeFrame ? this.#layout(this.#activeFrame) : null;
    this.#glyphCanvas.dataset.previewHeight = String(activeLayout?.previewHeight ?? 0);
    this.#glyphCanvas.dataset.previewHorizontal = String(
      this.#activeFrame?.previewExtents.horizontal ?? 0,
    );

    let readiness: GridReadiness = "Initial";
    if (this.#activeFrame) {
      const target = this.#targetFrame;
      const visibleGlyphIds = target
        ? this.#currentFrame(this.#layout(target), target).cells.map((cell) => cell.glyph.id)
        : [];
      const visible = visibleGlyphIds.every(
        (glyphId) => !this.#invalidGlyphIds.has(glyphId) && Boolean(layer?.hasGlyphs([glyphId])),
      );
      readiness = complete ? "Complete" : visible ? "Visible" : "Stale";
    }
    this.#glyphCanvas.dataset.gridReadiness = readiness;
  }

  #updateHoveredCatalogIndex(nextIndex: number | null): void {
    if (this.#hoveredCatalogIndex === nextIndex) return;
    this.#hoveredCatalogIndex = nextIndex;
    this.#container.style.cursor = nextIndex === null ? "" : "pointer";
  }

  #handleScroll = (): void => {
    this.#needsRedraw = true;
    void this.#refreshVisible();
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
    if (nameCell) {
      this.#activeFrame = { ...input, editingGlyphId: nameCell.glyph.id };
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

function mergePreviewExtents(
  current: SlugPreviewExtents,
  next: SlugPreviewExtents,
): SlugPreviewExtents {
  return {
    horizontal: Math.max(current.horizontal, next.horizontal),
    minimumY: Math.min(current.minimumY, next.minimumY),
    maximumY: Math.max(current.maximumY, next.maximumY),
  };
}

function sameGlyphIds(left: readonly GlyphId[], right: readonly GlyphId[]): boolean {
  return left.length === right.length && left.every((glyphId, index) => glyphId === right[index]);
}

function fallbackMetrics() {
  return {
    unitsPerEm: 1000,
    metricValues: [],
    ascender: 800,
    descender: -200,
    xHeight: 500,
    capHeight: 700,
    baseline: 0,
    italicAngle: 0,
    lineGap: 0,
    underlinePosition: -100,
    underlineThickness: 50,
  };
}
