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

const BACKGROUND_PAGE_SIZE = 2048;

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
  /** Single native page operation; aborted work retains this slot until it actually settles. */
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
      () => {
        const invalidGlyphIds = font.invalidGlyphIdsCell.value;
        this.#invalidate(invalidGlyphIds ?? font.glyphRecords().map((glyph) => glyph.id));
      },
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

  #invalidate(glyphIds: readonly GlyphId[]): void {
    for (const glyphId of glyphIds) this.#invalidGlyphIds.add(glyphId);
    this.#layer?.invalidate(glyphIds);
    this.#updateFullyResident();
    this.#refresh?.abort(new Error("resident font changed"));
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
      this.#updateFullyResident();
      this.#refresh = null;
      if (this.#frame?.active) await this.#refreshVisible();
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

    const pageGlyphIds = this.#viewportPageGlyphIds();
    const missingGlyphIds = pageGlyphIds.filter(
      (glyphId) => this.#invalidGlyphIds.has(glyphId) || !layer.hasGlyphs([glyphId]),
    );
    if (missingGlyphIds.length === 0) {
      if (pageGlyphIds.length === 0) this.#onReadyChange(true);
      this.redraw();
      if (!this.#refresh) this.#startBackgroundRefresh(pageGlyphIds);
      return;
    }

    const refresh = new AbortController();
    this.#refresh = refresh;
    this.#onReadyChange(false);

    try {
      await layer.loadPage(missingGlyphIds, refresh.signal);
      if (this.#disposed || this.#refresh !== refresh) return;
      for (const glyphId of missingGlyphIds) this.#invalidGlyphIds.delete(glyphId);
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

  #startBackgroundRefresh(pageGlyphIds: readonly GlyphId[]): void {
    const refresh = new AbortController();
    this.#refresh = refresh;
    void this.#refreshRemaining(refresh, pageGlyphIds).catch((error: unknown) => {
      if (this.#disposed || this.#refresh !== refresh) return;
      this.#refresh = null;
      if (refresh.signal.aborted) {
        if (this.#frame?.active) void this.#refreshVisible();
        return;
      }
      if (this.#layer) this.#failFrame(this.#layer, error);
    });
  }

  async #refreshRemaining(
    refresh: AbortController,
    pageGlyphIds: readonly GlyphId[],
  ): Promise<void> {
    const layer = this.#layer;
    const input = this.#frame;
    if (!layer || !input) return;

    const pageSet = new Set(pageGlyphIds);
    const remaining = input.glyphs
      .map((glyph) => glyph.id)
      .filter(
        (glyphId) =>
          !pageSet.has(glyphId) &&
          (this.#invalidGlyphIds.has(glyphId) || !layer.hasGlyphs([glyphId])),
      );
    const ordered = outwardGlyphIds(input.glyphs, remaining, pageGlyphIds);

    let visibleNeedsRefresh = false;
    for (let offset = 0; offset < ordered.length; offset += BACKGROUND_PAGE_SIZE) {
      refresh.signal.throwIfAborted();
      const visibleGlyphIds = this.#viewportPageGlyphIds();
      visibleNeedsRefresh = visibleGlyphIds.some(
        (glyphId) => this.#invalidGlyphIds.has(glyphId) || !layer.hasGlyphs([glyphId]),
      );
      if (visibleNeedsRefresh) break;

      const glyphIds = ordered.slice(offset, offset + BACKGROUND_PAGE_SIZE);
      await layer.loadPage(glyphIds, refresh.signal);
      if (this.#disposed || this.#refresh !== refresh) return;
      for (const glyphId of glyphIds) this.#invalidGlyphIds.delete(glyphId);
      this.#updateFullyResident();
      this.#needsRedraw = true;
      this.#firstFrameStarted = false;
      this.redraw();

      visibleNeedsRefresh = this.#viewportPageGlyphIds().some(
        (glyphId) => this.#invalidGlyphIds.has(glyphId) || !layer.hasGlyphs([glyphId]),
      );
      if (visibleNeedsRefresh) break;
    }

    if (this.#refresh !== refresh) return;
    this.#refresh = null;
    if (visibleNeedsRefresh) {
      void this.#refreshVisible();
      this.redraw();
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

  #viewportPageGlyphIds(): GlyphId[] {
    return viewportPageGlyphIds(this.#frame?.glyphs ?? [], this.#currentFrame());
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
      if (!this.#refresh) this.#startBackgroundRefresh(this.#viewportPageGlyphIds());
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

function viewportPageGlyphIds(
  glyphs: readonly GlyphCatalogItem[],
  frame: GlyphCatalogFrame,
): GlyphId[] {
  if (frame.cells.length === 0) return [];

  const firstIndex = frame.cells[0]!.catalogIndex;
  const lastIndex = frame.cells.at(-1)!.catalogIndex;
  const viewportCount = lastIndex - firstIndex + 1;
  const start = Math.max(0, firstIndex - viewportCount);
  const end = Math.min(glyphs.length, lastIndex + viewportCount + 1);
  return glyphs.slice(start, end).map((glyph) => glyph.id);
}

function outwardGlyphIds(
  glyphs: readonly GlyphCatalogItem[],
  remainingGlyphIds: readonly GlyphId[],
  pageGlyphIds: readonly GlyphId[],
): GlyphId[] {
  const remaining = new Set(remainingGlyphIds);
  const firstPageIndex =
    pageGlyphIds.length > 0 ? glyphs.findIndex((glyph) => glyph.id === pageGlyphIds[0]) : 0;
  const lastPageGlyphId = pageGlyphIds.at(-1);
  const lastPageIndex = lastPageGlyphId
    ? glyphs.findIndex((glyph) => glyph.id === lastPageGlyphId)
    : firstPageIndex;
  const ordered: GlyphId[] = [];
  let before = firstPageIndex - 1;
  let after = lastPageIndex + 1;

  while (before >= 0 || after < glyphs.length) {
    for (let count = 0; count < BACKGROUND_PAGE_SIZE && after < glyphs.length; count += 1) {
      const glyphId = glyphs[after++]!.id;
      if (remaining.delete(glyphId)) ordered.push(glyphId);
    }
    for (let count = 0; count < BACKGROUND_PAGE_SIZE && before >= 0; count += 1) {
      const glyphId = glyphs[before--]!.id;
      if (remaining.delete(glyphId)) ordered.push(glyphId);
    }
  }

  ordered.push(...remaining);
  return ordered;
}
