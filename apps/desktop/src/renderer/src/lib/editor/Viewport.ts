import { clamp } from "@/lib/utils/utils";
import type { Point2D, Rect2D } from "@shift/types";
import { Mat } from "@/lib/primitives/Mat";
import {
  signal,
  computed,
  type WritableSignal,
  type Signal,
} from "@/lib/reactive/signal";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 32;

export class Viewport {
  // Reactive viewport state (signals auto-invalidate derived matrices)
  readonly #zoom: WritableSignal<number>;
  readonly #panX: WritableSignal<number>;
  readonly #panY: WritableSignal<number>;
  readonly #upm: WritableSignal<number>;
  readonly #descender: WritableSignal<number>;
  readonly #padding: WritableSignal<number>;

  // Non-reactive state
  #canvasRect: Rect2D;
  #dpr: number;

  #mouseX: number;
  #mouseY: number;

  #upmX: number;
  #upmY: number;

  // Computed matrices (automatically recompute when dependencies change)
  readonly #upmToScreenMatrix: Signal<Mat>;
  readonly #screenToUpmMatrix: Signal<Mat>;

  constructor() {
    // Initialize signals
    this.#zoom = signal(1);
    this.#panX = signal(0);
    this.#panY = signal(0);
    this.#upm = signal(1000);
    this.#descender = signal(-200);
    this.#padding = signal(300);

    this.#dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    this.#mouseX = 0;
    this.#mouseY = 0;

    this.#upmX = 0;
    this.#upmY = 0;

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

    // Computed matrix: UPM → Screen
    // Automatically recomputes when zoom, pan, upm, descender, or padding change
    this.#upmToScreenMatrix = computed(() => {
      const scale = this.upmScale;
      const baselineY =
        this.logicalHeight -
        this.#padding.value -
        this.#descender.value * scale;
      const center = this.getCentrePoint();
      const zoom = this.#zoom.value;

      // 1. UPM → View: scale, flip Y, position baseline
      const upmTransform = Mat.Identity()
        .translate(this.#padding.value, baselineY)
        .scale(scale, -scale);

      // 2. View → Screen: zoom and pan around center
      const panX = this.#panX.value + center.x * (1 - zoom);
      const panY = this.#panY.value + center.y * (1 - zoom);
      const viewTransform = Mat.Identity()
        .translate(panX, panY)
        .scale(zoom, zoom);

      return Mat.Compose(viewTransform, upmTransform);
    });

    // Computed matrix: Screen → UPM (inverse)
    // Automatically recomputes when upmToScreenMatrix changes
    this.#screenToUpmMatrix = computed(() => {
      return Mat.Inverse(this.#upmToScreenMatrix.value);
    });
  }

  // **
  // Set the logical dimensions of the viewport
  // @param width - The width of the viewport
  // @param height - The height of the viewport
  // **
  setRect(rect: Rect2D) {
    this.#canvasRect = rect;
  }

  // **
  // Get the upm of the viewport
  // @returns The upm of the viewport
  // **
  get upm(): number {
    return this.#upm.value;
  }

  set upm(value: number) {
    this.#upm.value = value;
  }

  get descender(): number {
    return this.#descender.value;
  }

  set descender(value: number) {
    this.#descender.value = value;
  }

  get padding(): number {
    return this.#padding.value;
  }

  get upmScale(): number {
    const availableHeight = this.logicalHeight - 2 * this.#padding.value;
    if (availableHeight <= 0 || this.#upm.value <= 0) return 1;
    return availableHeight / this.#upm.value;
  }

  // **
  // Get the device width of the viewport,
  // scaled to the device pixel ratio
  // @returns The device width of the viewport
  // **
  get deviceWidth(): number {
    return this.#canvasRect.width * this.#dpr;
  }

  // **
  // Get the device height of the viewport,
  // scaled to the device pixel ratio
  // @returns The device height of the viewport
  // **
  get deviceHeight(): number {
    return this.#canvasRect.height * this.#dpr;
  }

  // **
  // Get the logical width of the viewport
  // @returns The logical width of the viewport
  // **
  get logicalWidth(): number {
    return this.#canvasRect.width;
  }

  // **
  // Get the logical height of the viewport
  // @returns The logical height of the viewport
  // **
  get logicalHeight(): number {
    return this.#canvasRect.height;
  }

  // **
  // Get the scale of the viewport
  // @returns The scale of the viewport
  // **
  get scale(): number {
    return this.#zoom.value;
  }

  // **
  // Get the device pixel ratio of the viewport
  // @returns The device pixel ratio of the viewport
  // **
  get dpr(): number {
    return this.#dpr;
  }

  public get zoom(): number {
    return this.#zoom.value;
  }

  // **
  // Get the mouse position of the viewport
  // @returns The mouse position of the viewport
  // **
  #calculateMousePosition(clientX: number, clientY: number): Point2D {
    const mouseX = clientX - this.#canvasRect.left;
    const mouseY = clientY - this.#canvasRect.top;

    this.#mouseX = Math.floor(mouseX);
    this.#mouseY = Math.floor(mouseY);

    return {
      x: this.#mouseX,
      y: this.#mouseY,
    };
  }

  public getMousePosition(x?: number, y?: number): Point2D {
    if (x === undefined || y === undefined) {
      return this.#calculateMousePosition(this.#mouseX, this.#mouseY);
    }

    return this.#calculateMousePosition(x, y);
  }

  public setMousePosition(x: number, y: number): void {
    this.#mouseX = x;
    this.#mouseY = y;
  }

  #projectScreenToUpmRaw(x: number, y: number): Point2D {
    return Mat.applyToPoint(this.#screenToUpmMatrix.value, { x, y });
  }

  public projectScreenToUpm(x: number, y: number) {
    const result = this.#projectScreenToUpmRaw(x, y);
    return {
      x: Math.floor(result.x),
      y: Math.floor(result.y),
    };
  }

  public projectUpmToScreen(x: number, y: number) {
    return Mat.applyToPoint(this.#upmToScreenMatrix.value, { x, y });
  }

  // **
  // Get the upm mouse position of the viewport
  // @returns The upm mouse position of the viewport
  // **
  getUpmMousePosition(): Point2D {
    return { x: this.#upmX, y: this.#upmY };
  }

  setUpmMousePosition(x: number, y: number): void {
    this.#upmX = x;
    this.#upmY = y;
  }

  public getCentrePoint(): Point2D {
    return { x: this.logicalWidth / 2, y: this.logicalHeight / 2 };
  }

  get panX(): number {
    return this.#panX.value;
  }

  get panY(): number {
    return this.#panY.value;
  }

  // **
  // Pan the viewport
  // @param x - The x position of the mouse
  // @param y - The y position of the mouse
  // **
  pan(x: number, y: number): void {
    this.#panX.value = x;
    this.#panY.value = y;
  }

  /**
   * Zoom toward a specific screen point
   *
   * Algorithm:
   * 1. Record UPM coordinate at cursor BEFORE zoom
   * 2. Apply zoom factor
   * 3. Get UPM coordinate at cursor AFTER zoom (same screen position, different UPM due to new matrices)
   * 4. Adjust pan by the delta to keep cursor over same UPM coordinate
   */
  public zoomToPoint(
    screenX: number,
    screenY: number,
    zoomDelta: number,
  ): void {
    const before = this.#projectScreenToUpmRaw(screenX, screenY);

    const newZoom = clamp(this.#zoom.value * zoomDelta, MIN_ZOOM, MAX_ZOOM);
    this.#zoom.value = newZoom;

    const after = this.#projectScreenToUpmRaw(screenX, screenY);

    const scale = this.upmScale;
    const deltaX = (before.x - after.x) * scale * newZoom;
    const deltaY = (before.y - after.y) * scale * newZoom;

    this.#panX.value -= deltaX;
    this.#panY.value += deltaY;
  }

  zoomIn(): void {
    const center = this.getCentrePoint();
    this.zoomToPoint(center.x, center.y, 1.25);
  }

  zoomOut(): void {
    const center = this.getCentrePoint();
    this.zoomToPoint(center.x, center.y, 0.8);
  }

  /**
   * Get the UPM to Screen transformation matrix
   */
  public getUpmToScreenMatrix(): Mat {
    return this.#upmToScreenMatrix.value.clone();
  }

  /**
   * Get the Screen to UPM transformation matrix
   */
  public getScreenToUpmMatrix(): Mat {
    return this.#screenToUpmMatrix.value.clone();
  }

  /**
   * Convert a screen-space distance to UPM-space distance.
   * Accounts for both UPM scale and zoom level.
   */
  public screenToUpmDistance(screenDistance: number): number {
    return screenDistance / (this.upmScale * this.#zoom.value);
  }

  /**
   * Get the effective scale factor (upmScale * zoom).
   */
  public get effectiveScale(): number {
    return this.upmScale * this.#zoom.value;
  }
}
