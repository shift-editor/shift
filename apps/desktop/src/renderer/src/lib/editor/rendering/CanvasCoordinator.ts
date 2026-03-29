import type { IGraphicContext, IRenderer, HandleState } from "@/types/graphics";
import type { Glyph, Point2D, PointId, AnchorId } from "@shift/types";
import type { Font } from "@/lib/editor/Font";
import type { Signal } from "@/lib/reactive/signal";
import type { SegmentId } from "@/types/indicator";
import type { Segment as SegmentType } from "@/types/segments";
import type { SnapIndicator } from "../snapping/types";
import type { DebugOverlays } from "@shared/ipc/types";
import type { DrawAPI } from "@/lib/tools/core/DrawAPI";
import type { ToolRenderContext, ToolRenderLayer } from "@/lib/tools/core/ToolRenderContributor";

import {
  DEFAULT_STYLES,
  GUIDE_STYLES,
  SNAP_INDICATOR_CROSS_SIZE_PX,
  resolveDrawStyle,
  type DrawStyle,
} from "@/lib/styles/style";

import { FrameHandler } from "./FrameHandler";
import { FpsMonitor } from "./FpsMonitor";
import { SCREEN_HIT_RADIUS, SCREEN_LINE_WIDTH } from "./constants";
import { DrawAPI as DrawAPIClass } from "@/lib/tools/core/DrawAPI";
import { ReglHandleContext } from "@/lib/graphics/backends/ReglHandleContext";

import {
  renderGuides,
  getGuides,
  renderGlyphOutline,
  renderGlyphFilled,
  renderSegmentHighlights,
  renderHandles,
  renderHandleControlLines,
  renderAnchors,
  renderSnapIndicators,
  renderDebugTightBounds,
  renderDebugHitRadii,
  renderDebugSegmentBounds,
  renderDebugGlyphBbox,
} from "./passes";
import { buildPackedGpuHandleInstances } from "./gpu/handleInstances";
import { getVisibleSceneBounds } from "./visibleSceneBounds";

const HANDLE_CULL_MARGIN_PX = 64;

/**
 * Parameters that position and scale the UPM coordinate system onto the screen.
 * Combines zoom/pan (user interaction) with the fixed UPM-to-pixel mapping
 * derived from font metrics and canvas dimensions.
 */
export interface ViewportTransform {
  /** User zoom level (1.0 = no zoom). Multiplied into the affine transform. */
  zoom: number;
  /** Horizontal pan offset in screen pixels. */
  panX: number;
  /** Vertical pan offset in screen pixels. */
  panY: number;
  /** Zoom origin in screen pixels -- zoom scales around this point. */
  centre: Point2D;
  /** Pixels per UPM unit, derived from canvas height and font UPM. */
  upmScale: number;
  /** Canvas logical height in CSS pixels, used to position the baseline. */
  logicalHeight: number;
  /** Horizontal padding in screen pixels between canvas edge and glyph origin. */
  padding: number;
  /** Font descender in UPM units (typically negative), used to offset the baseline vertically. */
  descender: number;
}

/**
 * Dependency interface that the {@link CanvasCoordinator} uses to read editor state
 * each frame. Keeps the coordinator decoupled from concrete Editor/ToolManager
 * implementations -- callers wire up callbacks at construction time.
 *
 * This contract is intentionally consumed indirectly by the renderer; concrete
 * implementations may require explicit dead-code suppression on members that are
 * only referenced through this interface.
 */
export interface CanvasCoordinatorContext {
  /** Sidebearing offset applied before glyph rendering, in UPM units. */
  getDrawOffset(): Point2D;
  setDrawOffset(offset: Point2D): void;
  readonly glyph: Signal<Glyph | null>;
  readonly font: Font;
  /** When true, renders filled glyph silhouette without guides or handles. */
  isPreviewMode(): boolean;
  isHandlesVisible(): boolean;
  isGpuHandlesEnabled(): boolean;
  getHoveredSegmentId(): SegmentId | null;
  isSegmentSelected(segmentId: SegmentId): boolean;
  getSelectedSegmentIds(): ReadonlySet<SegmentId>;
  getSegmentById(segmentId: SegmentId): SegmentType | null;
  getHandleState(pointId: PointId): HandleState;
  getAnchorHandleState(anchorId: AnchorId): HandleState;
  getSnapIndicator(): SnapIndicator | null;
  getViewportTransform(): ViewportTransform;
  /** Converts a screen-pixel distance to UPM units at the current zoom level. */
  screenToUpmDistance(px: number): number;
  /** Projects a point from UPM space to screen pixels, used for screen-space handle rendering. */
  projectSceneToScreen(x: number, y: number): Point2D;
  getDebugOverlays(): DebugOverlays;
  getVisualGlyphAdvance(glyph: Glyph): number;
  /** Delegates to the active tool's render method (interactive canvas). */
  renderTool(draw: DrawAPI): void;
  /** Delegates to the active tool's render-below-handles method (static canvas, drawn before point handles). */
  renderToolBelowHandles(draw: DrawAPI): void;
  renderToolContributors(layer: ToolRenderLayer, context: Omit<ToolRenderContext, "editor">): void;
  shouldRenderEditableGlyph(): boolean;
}

/**
 * Orchestrates all rendering across the editor's three-layer canvas stack.
 *
 * **Canvas layers (back to front):**
 * - **Static** -- core glyph passes plus tool contributors.
 * - **Overlay** -- transient visuals such as snap indicators.
 * - **Interactive** -- active-tool visuals plus interactive contributors.
 *
 * Each layer owns an independent {@link FrameHandler} so redraws are
 * coalesced per-layer via `requestAnimationFrame`.
 *
 * **Two-phase rendering (static layer):**
 * 1. **UPM space** -- `save()` -> viewport transforms -> contributors + glyph passes -> `restore()`.
 * 2. **Screen space** -- `save()` -> fixed-pixel contributors -> `restore()`.
 *
 * The overlay and interactive layers render exclusively in UPM space.
 */
export class CanvasCoordinator {
  #staticContext: IGraphicContext | null = null;
  #gpuHandleContext: ReglHandleContext | null = null;
  #overlayContext: IGraphicContext | null = null;
  #interactiveContext: IGraphicContext | null = null;
  #staticDraw: DrawAPIClass | null = null;
  #interactiveDraw: DrawAPIClass | null = null;
  #staticFrameHandler: FrameHandler;
  #overlayFrameHandler: FrameHandler;
  #interactiveFrameHandler: FrameHandler;
  #fpsMonitor: FpsMonitor;
  #ctx: CanvasCoordinatorContext;
  #packedGpuHandleInstances: Float32Array | null = null;
  #hasLoggedVisiblePointCount = false;

  constructor(ctx: CanvasCoordinatorContext) {
    this.#ctx = ctx;
    this.#staticFrameHandler = new FrameHandler();
    this.#overlayFrameHandler = new FrameHandler();
    this.#interactiveFrameHandler = new FrameHandler();
    this.#fpsMonitor = new FpsMonitor();
  }

  get fpsMonitor(): FpsMonitor {
    return this.#fpsMonitor;
  }

  #createScreenConverter() {
    return { toUpmDistance: (px: number) => this.#ctx.screenToUpmDistance(px) };
  }

  setStaticContext(context: IGraphicContext): void {
    this.#staticContext = context;
    this.#staticDraw = new DrawAPIClass(context.getContext(), this.#createScreenConverter());
  }

  setOverlayContext(context: IGraphicContext): void {
    this.#overlayContext = context;
  }

  setGpuHandleContext(context: ReglHandleContext): void {
    this.#gpuHandleContext = context;
  }

  setInteractiveContext(context: IGraphicContext): void {
    this.#interactiveContext = context;
    this.#interactiveDraw = new DrawAPIClass(context.getContext(), this.#createScreenConverter());
  }

  requestStaticRedraw(): void {
    this.#staticFrameHandler.requestUpdate(() => this.#drawStatic());
  }

  requestOverlayRedraw(): void {
    this.#overlayFrameHandler.requestUpdate(() => this.#drawOverlay());
  }

  requestInteractiveRedraw(): void {
    this.#interactiveFrameHandler.requestUpdate(() => this.#drawInteractive());
  }

  requestRedraw(): void {
    this.requestStaticRedraw();
    this.requestOverlayRedraw();
    this.requestInteractiveRedraw();
  }

  requestImmediateRedraw(): void {
    this.#drawStatic();
    this.#drawOverlay();
    this.#drawInteractive();
  }

  cancelRedraw(): void {
    this.#staticFrameHandler.cancelUpdate();
    this.#overlayFrameHandler.cancelUpdate();
    this.#interactiveFrameHandler.cancelUpdate();
  }

  #applyViewportTransform(ctx: IRenderer): void {
    const vt = this.#ctx.getViewportTransform();

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

  #applyTransforms(ctx: IRenderer): void {
    this.#applyViewportTransform(ctx);
    const { x, y } = this.#ctx.getDrawOffset();
    ctx.translate(x, y);
  }

  #pxToUpm(screenPixels = SCREEN_LINE_WIDTH): number {
    return this.#ctx.screenToUpmDistance(screenPixels);
  }

  #applyStyle(ctx: IRenderer, style: DrawStyle): void {
    ctx.setStyle(resolveDrawStyle(style, (px) => this.#pxToUpm(px)));
  }

  #createToolRenderContext(context: {
    draw?: DrawAPI;
    renderer?: IRenderer;
    visibleSceneBounds?: {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    };
  }): Omit<ToolRenderContext, "editor"> {
    return {
      ...context,
      pxToUpm: (px?: number) => this.#pxToUpm(px),
      applyStyle: (renderer, style) =>
        renderer.setStyle(resolveDrawStyle(style, (px) => this.#pxToUpm(px))),
      projectGlyphLocalToScreen: (point) => this.#projectGlyphLocalToScreen(point.x, point.y),
    };
  }

  #drawInteractive(): void {
    if (!this.#interactiveContext || !this.#interactiveDraw) return;
    const ctx = this.#interactiveContext.getContext();
    ctx.clear();
    ctx.save();

    this.#applyTransforms(ctx);
    this.#ctx.renderTool(this.#interactiveDraw);
    this.#ctx.renderToolContributors(
      "interactive-scene",
      this.#createToolRenderContext({
        draw: this.#interactiveDraw,
      }),
    );

    ctx.restore();
  }

  #drawOverlay(): void {
    if (!this.#overlayContext) return;
    const ctx = this.#overlayContext.getContext();
    ctx.clear();

    if (
      !this.#ctx.isPreviewMode() &&
      this.#ctx.isHandlesVisible() &&
      this.#ctx.shouldRenderEditableGlyph()
    ) {
      ctx.save();
      this.#ctx.renderToolContributors(
        "overlay-screen",
        this.#createToolRenderContext({
          renderer: ctx,
        }),
      );
      ctx.restore();
    }

    const indicator = this.#ctx.getSnapIndicator();
    if (!indicator) return;

    ctx.save();
    this.#applyTransforms(ctx);

    const rc = {
      ctx,
      pxToUpm: (px?: number) => this.#pxToUpm(px),
      applyStyle: (style: DrawStyle) => this.#applyStyle(ctx, style),
    };
    const crossHalf = this.#ctx.screenToUpmDistance(SNAP_INDICATOR_CROSS_SIZE_PX);
    renderSnapIndicators(rc, indicator, crossHalf);

    ctx.restore();
  }

  #drawStatic(): void {
    if (!this.#staticContext || !this.#staticDraw) return;
    const ctx = this.#staticContext.getContext();
    const draw = this.#staticDraw;

    const glyph = this.#ctx.glyph.peek();
    const previewMode = this.#ctx.isPreviewMode();
    const handlesVisible = this.#ctx.isHandlesVisible();
    const viewport = this.#ctx.getViewportTransform();
    const drawOffset = this.#ctx.getDrawOffset();
    const visibleSceneBounds = getVisibleSceneBounds(viewport, HANDLE_CULL_MARGIN_PX);

    const rc = {
      ctx,
      pxToUpm: (px?: number) => this.#pxToUpm(px),
      applyStyle: (style: DrawStyle) => this.#applyStyle(ctx, style),
    };

    ctx.clear();

    ctx.save();
    this.#applyViewportTransform(ctx);
    this.#ctx.renderToolContributors(
      "static-scene-before-handles",
      this.#createToolRenderContext({
        draw,
        visibleSceneBounds,
      }),
    );
    ctx.restore();

    const shouldRenderEditableGlyph = this.#ctx.shouldRenderEditableGlyph();
    if (!this.#hasLoggedVisiblePointCount && glyph && shouldRenderEditableGlyph) {
      console.log(`[CanvasCoordinator] Total glyph points: ${this.#countGlyphPoints(glyph)}`);
      this.#hasLoggedVisiblePointCount = true;
    }

    ctx.save();
    this.#applyTransforms(ctx);

    if (glyph && shouldRenderEditableGlyph) {
      const guides = getGuides(this.#ctx.getVisualGlyphAdvance(glyph), this.#ctx.font.getMetrics());
      rc.applyStyle(GUIDE_STYLES);

      if (!previewMode) {
        renderGuides(ctx, guides);
      }

      rc.applyStyle(DEFAULT_STYLES);
      const hasClosed = renderGlyphOutline(ctx, glyph, visibleSceneBounds, drawOffset);

      if (hasClosed && previewMode) {
        renderGlyphFilled(ctx, glyph, visibleSceneBounds, drawOffset);
      }
    }

    if (!previewMode && glyph && shouldRenderEditableGlyph) {
      const hoveredSegmentId = this.#ctx.getHoveredSegmentId();
      const hoveredSegment = hoveredSegmentId ? this.#ctx.getSegmentById(hoveredSegmentId) : null;
      const selectedSegments: SegmentType[] = [];
      for (const selectedSegmentId of this.#ctx.getSelectedSegmentIds()) {
        const segment = this.#ctx.getSegmentById(selectedSegmentId);
        if (segment) {
          selectedSegments.push(segment);
        }
      }
      renderSegmentHighlights(rc, hoveredSegment, selectedSegments);
    }

    if (!previewMode && glyph && shouldRenderEditableGlyph) {
      const debugOverlays = this.#ctx.getDebugOverlays();
      if (debugOverlays.segmentBounds) {
        renderDebugSegmentBounds(rc, glyph);
      }
      if (debugOverlays.tightBounds) {
        renderDebugTightBounds(rc, glyph, this.#ctx.getHoveredSegmentId());
      }
      if (debugOverlays.hitRadii) {
        renderDebugHitRadii(rc, glyph, this.#ctx.screenToUpmDistance(SCREEN_HIT_RADIUS));
      }
      if (debugOverlays.glyphBbox) {
        renderDebugGlyphBbox(rc, glyph);
      }
    }

    if (!previewMode) {
      this.#ctx.renderToolBelowHandles(draw);
    }

    if (!previewMode && handlesVisible && glyph && shouldRenderEditableGlyph) {
      renderHandleControlLines(draw, glyph, (from, to) =>
        this.#isSceneSegmentVisible(from, to, visibleSceneBounds, drawOffset),
      );
      const renderedOnGpu = this.#drawGpuHandles(glyph);
      if (!renderedOnGpu) {
        renderHandles(draw, glyph, (id) => this.#ctx.getHandleState(id));
      }
      renderAnchors(draw, glyph, (id) => this.#ctx.getAnchorHandleState(id));
    } else {
      this.#gpuHandleContext?.clear();
    }

    ctx.restore();
  }

  #drawGpuHandles(glyph: Glyph): boolean {
    if (!this.#ctx.isGpuHandlesEnabled()) return false;
    if (!this.#gpuHandleContext?.isAvailable()) return false;

    const viewport = this.#ctx.getViewportTransform();
    const drawOffset = this.#ctx.getDrawOffset();
    const { packedInstances, instanceCount } = buildPackedGpuHandleInstances(
      glyph,
      (id) => this.#ctx.getHandleState(id),
      viewport,
      drawOffset,
      this.#packedGpuHandleInstances,
    );
    this.#packedGpuHandleInstances = packedInstances;

    return this.#gpuHandleContext.draw({
      packedInstances,
      instanceCount,
      viewport,
      drawOffset,
      logicalWidth: viewport.centre.x * 2,
      logicalHeight: viewport.logicalHeight,
    });
  }

  #projectGlyphLocalToScreen(x: number, y: number): Point2D {
    const offset = this.#ctx.getDrawOffset();
    return this.#ctx.projectSceneToScreen(x + offset.x, y + offset.y);
  }

  #isSceneSegmentVisible(
    from: Point2D,
    to: Point2D,
    visibleSceneBounds: { minX: number; maxX: number; minY: number; maxY: number },
    drawOffset: Point2D,
  ): boolean {
    const minX = Math.min(from.x, to.x) + drawOffset.x;
    const maxX = Math.max(from.x, to.x) + drawOffset.x;
    const minY = Math.min(from.y, to.y) + drawOffset.y;
    const maxY = Math.max(from.y, to.y) + drawOffset.y;

    return !(
      maxX < visibleSceneBounds.minX ||
      minX > visibleSceneBounds.maxX ||
      maxY < visibleSceneBounds.minY ||
      minY > visibleSceneBounds.maxY
    );
  }

  #countGlyphPoints(glyph: Glyph): number {
    let count = 0;
    for (const contour of glyph.contours) {
      for (const _point of contour.points) {
        count += 1;
      }
    }
    return count;
  }

  destroy(): void {
    this.#staticContext?.destroy();
    this.#gpuHandleContext?.destroy();
    this.#overlayContext?.destroy();
    this.#interactiveContext?.destroy();
  }
}
