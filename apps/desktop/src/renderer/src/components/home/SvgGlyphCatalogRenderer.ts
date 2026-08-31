import type { Point2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { GlyphCatalogOverlay } from "./GlyphCatalogOverlay";
import { CanvasSurface } from "@/lib/editor/rendering/CanvasSurface";
import { GlyphPreviewCache } from "@/lib/catalog/GlyphPreviewCache";
import type {
  GlyphCatalogControllerFrame,
  GlyphCatalogFrame,
  GlyphCatalogItem,
  GlyphCatalogSource,
  GridReadiness,
} from "@/types/glyphCatalog";
import type { GlyphCatalogRenderer } from "@/types/glyphCatalogRenderer";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PREVIEW_BUDGET_BYTES = 256 * 1024 * 1024;
const PREVIEW_BATCH_SIZE = 256;
const PREFETCH_ROWS = 40;

/** Owns the DOM/SVG glyph catalog while preserving complete-frame publication. */
export class SvgGlyphCatalogRenderer implements GlyphCatalogRenderer {
  readonly kind = "svg" as const;
  readonly #container: HTMLDivElement;
  readonly #svg: SVGSVGElement;
  readonly #glyphPreviews: GlyphCatalogSource["glyphPreviews"];
  readonly #onEditGlyph: ((glyph: GlyphCatalogItem) => void) | null;
  readonly #onEditingUnavailable: () => void;
  readonly #openGlyph: ((glyph: GlyphCatalogItem) => Promise<void>) | null;
  readonly #onReadyChange: (ready: boolean) => void;
  readonly #onUnavailable: () => void;
  readonly #overlay: GlyphCatalogOverlay;
  readonly #cache = new GlyphPreviewCache(PREVIEW_BUDGET_BYTES);
  readonly #resizeObserver: ResizeObserver;
  readonly #unobserveAtlas: () => void;

  #targetFrame: GlyphCatalogControllerFrame | null = null;
  #activeFrame: GlyphCatalogControllerFrame | null = null;
  #pointer: Point2D | null = null;
  #hoveredCatalogIndex: number | null = null;
  #revision = 0;
  #refreshing = false;
  #ready = false;
  #disposed = false;

  /**
   * Creates the session fallback and begins observing its DOM viewport.
   *
   * @param container - Native scroll viewport that owns catalog interaction.
   * @param svg - Surface that receives atomically replaced preview trees.
   * @param overlayCanvas - Surface used for names and hover decoration.
   * @param glyphPreviews - Resolves lightweight paths at dense catalog coordinates.
   * @param observeAtlasInvalidation - Subscribes to directory and geometry revisions.
   * @param onEditGlyph - Starts inline naming, or null for read-only sessions.
   * @param onEditingUnavailable - Ends editing when its cell leaves the frame.
   * @param openGlyph - Opens a preview cell, or null when interaction is disabled.
   * @param onReadyChange - Publishes whether the selected renderer has a complete frame.
   * @param onUnavailable - Reports a selected SVG renderer that cannot present a frame.
   */
  constructor(
    container: HTMLDivElement,
    svg: SVGSVGElement,
    overlayCanvas: HTMLCanvasElement,
    glyphPreviews: GlyphCatalogSource["glyphPreviews"],
    observeAtlasInvalidation: GlyphCatalogSource["observeAtlasInvalidation"],
    onEditGlyph: ((glyph: GlyphCatalogItem) => void) | null,
    onEditingUnavailable: () => void,
    openGlyph: ((glyph: GlyphCatalogItem) => Promise<void>) | null,
    onReadyChange: (ready: boolean) => void,
    onUnavailable: () => void,
  ) {
    this.#container = container;
    this.#svg = svg;
    this.#glyphPreviews = glyphPreviews;
    this.#onEditGlyph = onEditGlyph;
    this.#onEditingUnavailable = onEditingUnavailable;
    this.#openGlyph = openGlyph;
    this.#onReadyChange = onReadyChange;
    this.#onUnavailable = onUnavailable;
    this.#overlay = new GlyphCatalogOverlay(overlayCanvas);
    this.#svg.dataset.gridReadiness = "Initial" satisfies GridReadiness;

    this.#resizeObserver = new ResizeObserver(() => this.#requestRefresh());
    this.#resizeObserver.observe(container);
    container.addEventListener("scroll", this.#handleScroll, { passive: true });
    container.addEventListener("pointermove", this.#handlePointerMove, { passive: true });
    container.addEventListener("pointerleave", this.#handlePointerLeave);
    container.addEventListener("click", this.#handleClick);
    document.fonts.addEventListener("loadingdone", this.#handleFontsLoaded);

    this.#unobserveAtlas = observeAtlasInvalidation((glyphIds) => {
      this.#cache.invalidate(glyphIds);
      this.#requestRefresh();
    });
  }

  update(frame: GlyphCatalogControllerFrame, inputContainer: HTMLDivElement | null): void {
    this.#targetFrame = frame;
    this.#overlay.setInputContainer(inputContainer);

    if (!frame.active) {
      this.#pointer = null;
      this.#updateHoveredCatalogIndex(null);
      return;
    }

    this.#requestRefresh();
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revision += 1;
    this.#unobserveAtlas();
    this.#resizeObserver.disconnect();
    this.#container.removeEventListener("scroll", this.#handleScroll);
    this.#container.removeEventListener("pointermove", this.#handlePointerMove);
    this.#container.removeEventListener("pointerleave", this.#handlePointerLeave);
    this.#container.removeEventListener("click", this.#handleClick);
    this.#container.style.cursor = "";
    document.fonts.removeEventListener("loadingdone", this.#handleFontsLoaded);
    this.#svg.replaceChildren();
  }

  #requestRefresh(): void {
    if (this.#disposed || !this.#targetFrame?.active) return;

    this.#revision += 1;
    if (!this.#refreshing) void this.#refreshFrames();
  }

  async #refreshFrames(): Promise<void> {
    this.#refreshing = true;
    try {
      while (!this.#disposed) {
        const revision = this.#revision;
        await this.#refreshFrame(revision);
        if (revision === this.#revision) return;
      }
    } catch (error) {
      if (this.#disposed) return;
      console.error("SVG glyph catalog refresh failed", error);
      this.#svg.dataset.gridReadiness = "Unavailable" satisfies GridReadiness;
      this.#onReadyChange(false);
      this.#onUnavailable();
    } finally {
      this.#refreshing = false;
    }
  }

  async #refreshFrame(revision: number): Promise<void> {
    const input = this.#targetFrame;
    if (!input?.active) return;

    const key = locationKey(input.location);
    this.#cache.rekey(key);
    const frame = this.#currentFrame(this.#layout(input), input);
    const visibleGlyphIds = frame.cells.map((cell) => cell.glyph.id);
    const missingGlyphIds = visibleGlyphIds.filter((glyphId) => !this.#cache.has(glyphId));
    if (missingGlyphIds.length > 0) {
      this.#svg.dataset.gridReadiness = this.#ready ? "Stale" : "Initial";
      await this.#load(missingGlyphIds, input.location, key);
    }

    if (this.#disposed || revision !== this.#revision || this.#targetFrame !== input) return;
    if (visibleGlyphIds.some((glyphId) => !this.#cache.has(glyphId))) return;

    this.#activeFrame = input;
    this.#draw(frame);
    this.#svg.dataset.gridReadiness = "Complete" satisfies GridReadiness;
    this.#svg.dataset.previewCacheBytes = String(this.#cache.bytes);
    if (!this.#ready) {
      this.#ready = true;
      this.#onReadyChange(true);
    }

    const prefetchGlyphIds = this.#prefetchGlyphIds(frame, input).filter(
      (glyphId) => !this.#cache.has(glyphId),
    );
    await this.#load(prefetchGlyphIds, input.location, key);
  }

  async #load(
    glyphIds: readonly GlyphId[],
    location: readonly number[],
    key: string,
  ): Promise<void> {
    for (let start = 0; start < glyphIds.length; start += PREVIEW_BATCH_SIZE) {
      const batch = glyphIds.slice(start, start + PREVIEW_BATCH_SIZE);
      const previews = await this.#glyphPreviews(batch, location);
      if (this.#disposed || this.#cache.key !== key) return;

      this.#cache.fill(batch, previews);
    }
  }

  #prefetchGlyphIds(
    frame: GlyphCatalogFrame,
    input: GlyphCatalogControllerFrame,
  ): readonly GlyphId[] {
    const firstIndex = frame.cells[0]?.catalogIndex ?? 0;
    const lastIndex = frame.cells.at(-1)?.catalogIndex ?? firstIndex;
    const radius = frame.layout.columns * PREFETCH_ROWS;
    return input.glyphs
      .slice(
        Math.max(0, firstIndex - radius),
        Math.min(input.glyphs.length, lastIndex + radius + 1),
      )
      .map((glyph) => glyph.id);
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

  #draw(frame = this.#currentFrame()): void {
    const input = this.#activeFrame;
    if (!input?.active || frame.cells.some((cell) => !this.#cache.has(cell.glyph.id))) return;

    this.#svg.setAttribute(
      "viewBox",
      `0 0 ${frame.layout.viewportWidth} ${frame.layout.viewportHeight}`,
    );
    const fragment = document.createDocumentFragment();
    for (const cell of frame.cells) {
      const preview = this.#cache.get(cell.glyph.id);
      if (!preview?.svgPath) continue;

      const viewport = document.createElementNS(SVG_NAMESPACE, "svg");
      const layout = new GlyphPreviewLayout(
        input.metrics,
        preview.xAdvance,
        cell.previewRect.height,
      );
      viewport.setAttribute("x", String(cell.previewContentRect.left));
      viewport.setAttribute("y", String(cell.previewContentRect.top));
      viewport.setAttribute("width", String(cell.previewContentRect.width));
      viewport.setAttribute("height", String(cell.previewContentRect.height));
      viewport.setAttribute("viewBox", layout.viewBox);
      viewport.setAttribute("preserveAspectRatio", "xMidYMid meet");

      const group = document.createElementNS(SVG_NAMESPACE, "g");
      group.setAttribute("transform", "scale(1, -1)");
      const path = document.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute("d", preview.svgPath);
      path.setAttribute("fill", "currentColor");
      path.setAttribute("fill-rule", "nonzero");
      group.append(path);
      viewport.append(group);
      fragment.append(viewport);
    }
    this.#svg.replaceChildren(fragment);
    this.#drawOverlay(frame);
  }

  #drawOverlay(frame = this.#currentFrame()): void {
    const input = this.#activeFrame;
    if (!input?.active) return;

    const hoveredCell = this.#pointer ? this.#layout(input).hit(frame, this.#pointer) : null;
    this.#updateHoveredCatalogIndex(hoveredCell?.catalogIndex ?? null);
    this.#overlay.draw(this.#container, frame, hoveredCell?.catalogIndex ?? null);
    if (input.editingGlyphId && !this.#overlay.positionInput(frame, input.editingGlyphId)) {
      this.#onEditingUnavailable();
    }
  }

  #updateHoveredCatalogIndex(nextIndex: number | null): void {
    if (this.#hoveredCatalogIndex === nextIndex) return;
    this.#hoveredCatalogIndex = nextIndex;
    const interactive = this.#onEditGlyph !== null || this.#openGlyph !== null;
    this.#container.style.cursor = nextIndex === null || !interactive ? "" : "pointer";
  }

  #handleScroll = (): void => this.#requestRefresh();

  #handlePointerMove = (event: PointerEvent): void => {
    this.#pointer = CanvasSurface.localPoint(this.#container, {
      x: event.clientX,
      y: event.clientY,
    });
    if (this.#activeFrame) this.#drawOverlay();
  };

  #handlePointerLeave = (): void => {
    this.#pointer = null;
    this.#updateHoveredCatalogIndex(null);
    if (this.#activeFrame) this.#drawOverlay();
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

  #handleFontsLoaded = (): void => {
    if (this.#activeFrame) this.#drawOverlay();
  };
}

function locationKey(location: readonly number[]): string {
  return location.join("|");
}
