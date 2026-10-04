import { clamp } from "../../utils/utils";
import { Mat, Vec2, type Point2D, type Rect2D } from "@shift/geo";
import {
  batch,
  signal,
  computed,
  type WritableSignal,
  type Signal,
  type ComputedSignal,
} from "../../signals/signal";
import type {
  SceneBounds,
  ScenePoint,
  SceneVector,
  ScreenPoint,
  ScreenVector,
  SpaceTransform,
} from "../../../types/coordinates";
import { SCREEN_HIT_RADIUS } from "../rendering/constants";
import {
  applyLinear,
  applyTransform,
  invertTransform,
  screenPoint,
  spaceTransform,
  transformBounds,
} from "../spaces";

/** Smallest zoom, in screen pixels per scene unit. */
const MIN_ZOOM = 0.01;
/** Largest zoom, in screen pixels per scene unit. */
const MAX_ZOOM = 32;
/** Fraction of the canvas that fitted bounds fill along their tighter axis. */
const FIT_FILL = 0.85;

/**
 * Snapshot of the camera values one frame draws with.
 *
 * @remarks
 * Correct for one frame only; it goes stale as soon as the pan or zoom changes.
 */
export interface CameraTransform {
  /** Scene → screen, in logical pixels. */
  view: SpaceTransform<"scene", "screen">;
  /** Screen pixels per scene unit. */
  zoom: number;
  /** Canvas width in logical pixels. */
  logicalWidth: number;
  /** Canvas height in logical pixels. */
  logicalHeight: number;
}

/**
 * Scene-space rectangle covered by the viewport, reused across frames.
 *
 * @remarks
 * Mutable so per-frame culling allocates nothing. Edges are inclusive.
 */
export class VisibleSceneBounds {
  constructor(
    public minX: number,
    public maxX: number,
    public minY: number,
    public maxY: number,
  ) {}

  /** Overwrites all four edges in place and returns this object. */
  set(minX: number, maxX: number, minY: number, maxY: number): this {
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
    return this;
  }

  /** Returns whether the scene point lies inside the rectangle or on an edge. */
  contains(point: Point2D): boolean {
    return (
      point.x >= this.minX && point.x <= this.maxX && point.y >= this.minY && point.y <= this.maxY
    );
  }
}

/**
 * Maps between scene space and screen space for one canvas viewport.
 *
 * @remarks
 * The camera's state is `pan` and `zoom`. `pan` is the screen position, in
 * logical pixels, at which the scene origin is drawn; `zoom` is screen pixels
 * per scene unit. Screen space is Y-down with its origin at the canvas
 * top-left. Scene space is Y-down too, so the view has no flip.
 *
 * The view depends only on `pan` and `zoom`, never on the canvas size, so
 * resizing the canvas leaves every scene point where it was on screen.
 */
export class Camera {
  readonly #zoom = signal(1, { name: "camera.zoom" });
  readonly #pan = signal<Point2D>(
    { x: 0, y: 0 },
    { name: "camera.pan", equals: (a, b) => a.x === b.x && a.y === b.y },
  );

  #canvasRect: Rect2D;
  #initialFitBounds: SceneBounds | null;

  readonly #visibleSceneBounds = new VisibleSceneBounds(0, 0, 0, 0);

  #pendingClientX: number;
  #pendingClientY: number;

  readonly #screenMousePosition: WritableSignal<ScreenPoint>;
  readonly #view: ComputedSignal<SpaceTransform<"scene", "screen">>;
  readonly #inverseView: ComputedSignal<SpaceTransform<"screen", "scene">>;

  constructor() {
    this.#initialFitBounds = null;

    this.#pendingClientX = 0;
    this.#pendingClientY = 0;
    this.#screenMousePosition = signal<ScreenPoint>(screenPoint(0, 0), {
      name: "camera.screenMousePosition",
    });

    this.#canvasRect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    };

    this.#view = computed(
      () => {
        const pan = this.#pan.value;
        const zoom = this.#zoom.value;

        const view = Mat.Compose(Mat.Translate(pan.x, pan.y), Mat.Scale(zoom, zoom));
        return spaceTransform(view);
      },
      { name: "camera.view" },
    );

    this.#inverseView = computed(() => invertTransform(this.#view.value), {
      name: "camera.inverseView",
    });
  }

  /**
   * Records the canvas's page position and logical size.
   *
   * @remarks
   * Does not change the view. While initial framing is active, refits it to the
   * new size.
   *
   * @param rect - canvas bounds in page CSS pixels; `left` and `top` convert client
   * pointer coordinates into canvas pixels.
   * @see {@link fitInitialBounds}
   */
  setRect(rect: Rect2D) {
    this.#canvasRect = rect;

    if (this.#initialFitBounds) this.fitToBounds(this.#initialFitBounds);
  }

  /** Canvas width in logical pixels; 0 before the first {@link setRect}. */
  get logicalWidth(): number {
    return this.#canvasRect.width;
  }

  /** Canvas height in logical pixels; 0 before the first {@link setRect}. */
  get logicalHeight(): number {
    return this.#canvasRect.height;
  }

  /** Reactive zoom, in screen pixels per scene unit. */
  public get zoomCell(): Signal<number> {
    return this.#zoom;
  }

  /** Current zoom, in screen pixels per scene unit, read without tracking. */
  get zoomLevel(): number {
    return this.#zoom.peek();
  }

  /** Canvas centre in logical pixels; the anchor for zooms that have no pointer. */
  get centre(): ScreenPoint {
    return screenPoint(this.logicalWidth / 2, this.logicalHeight / 2);
  }

  /** Reactive screen position of the scene origin, in logical pixels. */
  get panCell(): Signal<Point2D> {
    return this.#pan;
  }

  /**
   * Current screen position of the scene origin, read without tracking.
   *
   * @see {@link setPan}
   */
  get pan(): Point2D {
    return this.#pan.peek();
  }

  /**
   * Reactive scene-to-screen matrix.
   *
   * @remarks
   * Depends only on `pan` and `zoom`. Use {@link screenToScene} for the
   * reverse direction rather than inverting this per call.
   */
  get viewCell(): Signal<SpaceTransform<"scene", "screen">> {
    return this.#view;
  }

  /**
   * Subscribes the current reactive scope to every camera input.
   *
   * @remarks
   * Reads the source signals rather than the derived matrix so that signal
   * debugging names the exact input (pan or zoom) that caused a redraw.
   */
  trackViewportTransform(): void {
    this.#zoom.value;
    this.#pan.value;
  }

  /**
   * Pointer hit radius in scene units at the current zoom.
   *
   * @remarks
   * Constant on screen, so it grows in scene units as the camera zooms out.
   */
  get hitRadius(): number {
    return this.screenToSceneDistance(SCREEN_HIT_RADIUS);
  }

  /**
   * Last published pointer position in scene space, read without tracking.
   *
   * @see {@link flushMousePosition}
   */
  get mousePosition(): ScenePoint {
    return this.screenToScene(this.#screenMousePosition.peek());
  }

  /** Reactive pointer position in canvas logical pixels; changes on {@link flushMousePosition}. */
  get screenMousePositionCell(): Signal<ScreenPoint> {
    return this.#screenMousePosition;
  }

  /** Last published pointer position in canvas logical pixels, read without tracking. */
  get screenMousePosition(): ScreenPoint {
    return this.#screenMousePosition.peek();
  }

  /** Last published pointer position in canvas logical pixels, read without tracking. */
  getScreenMousePosition(): ScreenPoint {
    return this.#screenMousePosition.peek();
  }

  /**
   * Buffers a pointer position without publishing it.
   *
   * @remarks
   * Call {@link flushMousePosition} to publish. Buffering lets high-frequency
   * pointer events update the reactive position once per frame.
   *
   * @param clientX - horizontal position in viewport client pixels.
   * @param clientY - vertical position in viewport client pixels.
   */
  updateMousePosition(clientX: number, clientY: number): void {
    this.#pendingClientX = clientX;
    this.#pendingClientY = clientY;
  }

  /** Publishes the buffered pointer position in canvas logical pixels, floored to whole pixels. */
  flushMousePosition(): void {
    this.#screenMousePosition.set(
      screenPoint(
        Math.floor(this.#pendingClientX - this.#canvasRect.left),
        Math.floor(this.#pendingClientY - this.#canvasRect.top),
      ),
    );
  }

  /**
   * Converts a canvas point to scene space, read without tracking.
   *
   * @param screen - logical pixels from the canvas's top-left, Y-down.
   * @returns a new scene-space point.
   */
  public screenToScene(screen: ScreenPoint): ScenePoint {
    return applyTransform(this.#inverseView.peek(), screen);
  }

  /**
   * Converts a scene point to canvas logical pixels, read without tracking.
   *
   * @param scene - a scene-space point.
   * @returns a new point in logical pixels from the canvas top-left, Y-down.
   */
  public sceneToScreen(scene: ScenePoint): ScreenPoint {
    return applyTransform(this.#view.peek(), scene);
  }

  /**
   * Converts a canvas displacement to scene units, read without tracking.
   *
   * @remarks
   * Applies only the view's scale; a displacement is unaffected by pan.
   *
   * @param screen - a displacement in logical pixels.
   */
  public screenToSceneVector(screen: ScreenVector): SceneVector {
    return applyLinear(this.#inverseView.peek(), screen);
  }

  /**
   * Moves the camera so the scene origin is drawn at the given screen position.
   *
   * @remarks
   * Ends initial framing.
   *
   * @param pan - screen position of the scene origin, in logical pixels.
   */
  setPan(pan: Point2D): void {
    this.#initialFitBounds = null;
    this.#pan.set(pan);
  }

  /**
   * Scales the zoom while keeping the scene point under a screen position fixed.
   *
   * @remarks
   * The resulting zoom is clamped to the supported range. Ends initial framing.
   *
   * @param anchor - the screen position that stays over the same scene point.
   * @param zoomDelta - multiplier applied to the current zoom; above 1 zooms in.
   */
  public zoomToPoint(anchor: ScreenPoint, factor: number): void {
    this.#initialFitBounds = null;
    const clampedZoom = clamp(factor * this.zoomLevel, MIN_ZOOM, MAX_ZOOM);
    const before = applyTransform(this.#inverseView.peek(), anchor);

    batch(() => {
      this.#zoom.set(clampedZoom);

      const afterScreen = applyTransform(this.#view.peek(), before);
      const correction = Vec2.sub(anchor, afterScreen);

      this.#pan.update((pan) => Vec2.add(pan, correction));
    });
  }

  /** Zooms in by 25% around the canvas centre. */
  zoomIn(): void {
    this.zoomToPoint(this.centre, 1.25);
  }

  /** Zooms out around the canvas centre, undoing one {@link zoomIn}. */
  zoomOut(): void {
    this.zoomToPoint(this.centre, 0.8);
  }

  /**
   * Sets an absolute zoom around the canvas centre.
   *
   * @remarks
   * Ignores non-finite and non-positive values; otherwise clamps like
   * {@link zoomToPoint}.
   *
   * @param zoom - target screen pixels per scene unit.
   */
  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom) || zoom <= 0) return;

    this.zoomToPoint(this.centre, zoom / this.zoomLevel);
  }

  /**
   * Frames bounds and keeps refitting them on resize until the camera is moved.
   *
   * @remarks
   * Panning, zooming, or fitting other bounds ends initial framing.
   *
   * @param bounds - scene-space rectangle to frame; copied, so later changes to
   * the caller's object have no effect.
   */
  fitInitialBounds(bounds: SceneBounds): void {
    this.#initialFitBounds = { ...bounds };
    this.fitToBounds(this.#initialFitBounds);
  }

  /**
   * Zooms and pans once so the bounds fill most of the canvas, centred.
   *
   * @remarks
   * Does nothing for empty or non-finite bounds, or before the canvas has a size.
   * Ends initial framing unless these are the initial bounds.
   *
   * @param bounds - scene-space rectangle to frame.
   */
  fitToBounds(bounds: SceneBounds): void {
    if (bounds !== this.#initialFitBounds) this.#initialFitBounds = null;

    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    const boundsHaveArea =
      Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    const viewportHasSize = this.logicalWidth > 0 && this.logicalHeight > 0;
    if (!boundsHaveArea || !viewportHasSize) return;

    const zoom = clamp(
      FIT_FILL * Math.min(this.logicalWidth / width, this.logicalHeight / height),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    const boundsCentre = { x: bounds.min.x + width / 2, y: bounds.min.y + height / 2 };
    const pan = Vec2.sub(this.centre, Vec2.scale(boundsCentre, zoom));

    batch(() => {
      this.#zoom.set(zoom);
      this.#pan.set(pan);
    });
  }

  /**
   * Converts a length in screen pixels to scene units at the current zoom.
   *
   * @param screenDistance - length in logical pixels.
   */
  public screenToSceneDistance(screenDistance: number): number {
    return screenDistance / this.zoomLevel;
  }

  /**
   * Returns the scene-space rectangle visible in the canvas, grown by a margin.
   *
   * @param cullMarginPx - extra logical pixels on every side, so content just
   * off-screen is still included.
   * @returns a shared object that the next call overwrites; copy it to keep it.
   */
  visibleSceneBounds(cullMarginPx: number): VisibleSceneBounds {
    const canvas = {
      min: screenPoint(-cullMarginPx, -cullMarginPx),
      max: screenPoint(this.logicalWidth + cullMarginPx, this.logicalHeight + cullMarginPx),
    };
    const { min, max } = transformBounds(this.#inverseView.peek(), canvas);

    return this.#visibleSceneBounds.set(min.x, max.x, min.y, max.y);
  }
}
