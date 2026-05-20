import { clamp } from "@/lib/utils/utils";
import { Mat, type Point2D, type Rect2D } from "@shift/geo";
import {
  signal,
  computed,
  type WritableSignal,
  type Signal,
  type ComputedSignal,
} from "@/lib/signals/signal";
import { SCREEN_HIT_RADIUS } from "../rendering/constants";

/** Lower bound for zoom level. Prevents the glyph from becoming invisible. */
const MIN_ZOOM = 0.01;
/** Upper bound for zoom level. Prevents extreme magnification artifacts. */
const MAX_ZOOM = 32;
/** Preferred padding in screen pixels around the glyph drawing area. */
const DEFAULT_PADDING = 300;
/** Keep the zoom-1 glyph scale stable as the viewport gets vertically constrained. */
const MIN_GLYPH_VIEW_HEIGHT = 200;

/**
 * Snapshot of the camera values needed to project UPM-space drawing into screen space.
 */
export interface CameraTransform {
  zoom: number;
  panX: number;
  panY: number;
  centre: Point2D;
  upmScale: number;
  logicalHeight: number;
  layoutHeight: number;
  padding: number;
  descender: number;
}

export class VisibleSceneBounds {
  constructor(
    public minX: number,
    public maxX: number,
    public minY: number,
    public maxY: number,
  ) {}

  set(minX: number, maxX: number, minY: number, maxY: number): this {
    this.minX = minX;
    this.maxX = maxX;
    this.minY = minY;
    this.maxY = maxY;
    return this;
  }

  contains(point: Point2D): boolean {
    return (
      point.x >= this.minX && point.x <= this.maxX && point.y >= this.minY && point.y <= this.maxY
    );
  }
}

/**
 * Owns the UPM-to-screen and screen-to-UPM coordinate transformations.
 *
 * The glyph coordinate system (UPM space) has Y-up with the origin at the
 * baseline; screen space has Y-down with the origin at the top-left corner of
 * the canvas. Camera maintains two lazily-computed affine matrices
 * that map between these spaces, incorporating zoom, pan, DPR, descender
 * offset, and padding.
 *
 * Tools, hit-testing, and rendering all go through this camera to convert
 * positions, distances, and radii between the two coordinate systems.
 */
export class Camera {
  readonly #zoom: WritableSignal<number>;
  readonly #panX: WritableSignal<number>;
  readonly #panY: WritableSignal<number>;
  readonly #upm: WritableSignal<number>;
  readonly #descender: WritableSignal<number>;

  #canvasRect: Rect2D;
  #layoutHeight: number;

  readonly #visibleSceneBounds = new VisibleSceneBounds(0, 0, 0, 0);

  #mouseX: number;
  #mouseY: number;
  #pendingClientX: number;
  #pendingClientY: number;

  readonly #screenMousePosition: WritableSignal<Point2D>;
  readonly #upmToScreenMatrix: ComputedSignal<Mat>;
  readonly #screenToUpmMatrix: ComputedSignal<Mat>;

  constructor() {
    this.#zoom = signal(1, { name: "camera.zoom" });
    this.#panX = signal(0, { name: "camera.panX" });
    this.#panY = signal(0, { name: "camera.panY" });
    this.#upm = signal(1000, { name: "camera.upm" });
    this.#descender = signal(-200, { name: "camera.descender" });
    this.#layoutHeight = 0;

    this.#mouseX = 0;
    this.#mouseY = 0;
    this.#pendingClientX = 0;
    this.#pendingClientY = 0;
    this.#screenMousePosition = signal<Point2D>(
      { x: 0, y: 0 },
      {
        name: "camera.screenMousePosition",
      },
    );

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

    this.#upmToScreenMatrix = computed(
      () => {
        this.#upm.value;
        const scale = this.upmScale;
        const padding = this.padding;
        const baselineY = this.layoutHeight - padding - this.#descender.value * scale;
        const zoom = this.#zoom.value;

        const upmTransform = Mat.Identity().translate(padding, baselineY).scale(scale, -scale);

        const panX = this.#panX.value + this.centre.x * (1 - zoom);
        const panY = this.#panY.value + this.centre.y * (1 - zoom);
        const viewTransform = Mat.Identity().translate(panX, panY).scale(zoom, zoom);

        return Mat.Compose(viewTransform, upmTransform);
      },
      { name: "camera.upmToScreenMatrix" },
    );

    this.#screenToUpmMatrix = computed(
      () => {
        return Mat.Inverse(this.#upmToScreenMatrix.value);
      },
      { name: "camera.screenToUpmMatrix" },
    );
  }

  setRect(rect: Rect2D) {
    const shouldPreserveProjection = this.logicalWidth > 0 && this.logicalHeight > 0;
    const before = shouldPreserveProjection ? this.projectScreenToScene(0, 0) : null;

    this.#canvasRect = rect;
    if (this.#layoutHeight <= 0 && rect.height > 0) {
      this.#layoutHeight = rect.height;
    }
    this.#upmToScreenMatrix.invalidate();
    this.#screenToUpmMatrix.invalidate();

    if (!before) return;

    const after = this.projectScreenToScene(0, 0);
    const scale = this.upmScale;
    const zoom = this.zoomLevel;
    this.#panX.update((panX) => panX - (before.x - after.x) * scale * zoom);
    this.#panY.update((panY) => panY + (before.y - after.y) * scale * zoom);
  }

  /** @knipclassignore */
  get upm(): number {
    return this.#upm.peek();
  }

  /** @knipclassignore */
  set upm(value: number) {
    this.#upm.set(value);
  }

  /** @knipclassignore */
  get descender(): number {
    return this.#descender.peek();
  }

  /** @knipclassignore */
  set descender(value: number) {
    this.#descender.set(value);
  }

  get padding(): number {
    const maxPadding = (this.layoutHeight - MIN_GLYPH_VIEW_HEIGHT) / 2;
    return Math.max(0, Math.min(DEFAULT_PADDING, maxPadding));
  }

  /** Pixels per UPM unit at zoom 1. */
  get upmScale(): number {
    const availableHeight = this.layoutHeight - 2 * this.padding;
    const upm = this.#upm.peek();
    if (availableHeight <= 0 || upm <= 0) return 1;
    return availableHeight / upm;
  }

  get logicalWidth(): number {
    return this.#canvasRect.width;
  }

  get logicalHeight(): number {
    return this.#canvasRect.height;
  }

  get layoutHeight(): number {
    return this.#layoutHeight;
  }

  public get zoomCell(): Signal<number> {
    return this.#zoom;
  }

  get zoomLevel(): number {
    return this.#zoom.peek();
  }

  get centre(): Point2D {
    return { x: this.logicalWidth / 2, y: this.logicalHeight / 2 };
  }

  get pan(): Point2D {
    return { x: this.#panX.peek(), y: this.#panY.peek() };
  }

  get panX(): number {
    return this.#panX.peek();
  }

  get panY(): number {
    return this.#panY.peek();
  }

  /**
   * Track the camera inputs used to build UPM-space render transforms.
   *
   * Call this only inside a render dependency boundary. It intentionally reads
   * the source cells, rather than a derived transform object, so debug output
   * shows the exact camera input that caused a redraw.
   */
  trackViewportTransform(): void {
    this.#zoom.value;
    this.#panX.value;
    this.#panY.value;
    this.#upm.value;
    this.#descender.value;
  }

  /** Hit-test radius in UPM units. Grows as you zoom out so handles remain clickable. */
  get hitRadius(): number {
    return this.screenToUpmDistance(SCREEN_HIT_RADIUS);
  }

  get mousePosition(): Point2D {
    return this.projectScreenToScene(this.#mouseX, this.#mouseY);
  }

  get screenMousePositionCell(): Signal<Point2D> {
    return this.#screenMousePosition;
  }

  get screenMousePosition(): Point2D {
    return this.#screenMousePosition.peek();
  }

  getScreenMousePosition(): Point2D {
    return this.#screenMousePosition.peek();
  }

  /**
   * Buffers a raw client mouse position. Call {@link flushMousePosition} to
   * commit it to the screen-space signal. This two-phase update avoids
   * redundant UPM projections during high-frequency mouse events.
   */
  updateMousePosition(clientX: number, clientY: number): void {
    this.#pendingClientX = clientX;
    this.#pendingClientY = clientY;
  }

  flushMousePosition(): void {
    this.#mouseX = Math.floor(this.#pendingClientX - this.#canvasRect.left);
    this.#mouseY = Math.floor(this.#pendingClientY - this.#canvasRect.top);
    this.#screenMousePosition.set({ x: this.#mouseX, y: this.#mouseY });
  }

  /** Screen pixels (Y-down, origin top-left) to scene (UPM, Y-up, origin baseline). */
  public projectScreenToScene(x: number, y: number): Point2D {
    return Mat.applyToPoint(this.#screenToUpmMatrix.peek(), { x, y });
  }

  /** Scene (UPM, Y-up, origin baseline) to screen pixels (Y-down, origin top-left). */
  public projectSceneToScreen(x: number, y: number): Point2D {
    return Mat.applyToPoint(this.#upmToScreenMatrix.peek(), { x, y });
  }

  setPan(x: number, y: number): void {
    this.#panX.set(x);
    this.#panY.set(y);
  }

  /**
   * Zooms toward or away from a screen-space point, adjusting pan so the
   * point under the cursor stays fixed. Used for scroll-wheel zoom.
   */
  public zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void {
    const before = this.projectScreenToScene(screenX, screenY);

    const newZoom = clamp(this.#zoom.peek() * zoomDelta, MIN_ZOOM, MAX_ZOOM);
    this.#zoom.set(newZoom);

    const after = this.projectScreenToScene(screenX, screenY);

    const scale = this.upmScale;
    const deltaX = (before.x - after.x) * scale * newZoom;
    const deltaY = (before.y - after.y) * scale * newZoom;

    this.#panX.update((panX) => panX - deltaX);
    this.#panY.update((panY) => panY + deltaY);
  }

  zoomIn(): void {
    this.zoomToPoint(this.centre.x, this.centre.y, 1.25);
  }

  zoomOut(): void {
    this.zoomToPoint(this.centre.x, this.centre.y, 0.8);
  }

  public screenToUpmDistance(screenDistance: number): number {
    return screenDistance / (this.upmScale * this.zoomLevel);
  }

  /** Returns a reusable bounds object for the current camera frame. Do not retain it. */
  visibleSceneBounds(cullMarginPx: number): VisibleSceneBounds {
    const logicalWidth = this.logicalWidth;
    const logicalHeight = this.logicalHeight;
    const centreX = logicalWidth / 2;
    const centreY = logicalHeight / 2;
    const zoom = this.zoomLevel;
    const viewTranslateX = this.panX + centreX * (1 - zoom);
    const viewTranslateY = this.panY + centreY * (1 - zoom);
    const baselineY = this.layoutHeight - this.padding - this.descender * this.upmScale;
    const zoomedScale = this.upmScale * zoom;
    const minScreenX = -cullMarginPx;
    const maxScreenX = logicalWidth + cullMarginPx;
    const minScreenY = -cullMarginPx;
    const maxScreenY = logicalHeight + cullMarginPx;

    return this.#visibleSceneBounds.set(
      (minScreenX - viewTranslateX - this.padding * zoom) / zoomedScale,
      (maxScreenX - viewTranslateX - this.padding * zoom) / zoomedScale,
      (baselineY * zoom + viewTranslateY - maxScreenY) / zoomedScale,
      (baselineY * zoom + viewTranslateY - minScreenY) / zoomedScale,
    );
  }
}
