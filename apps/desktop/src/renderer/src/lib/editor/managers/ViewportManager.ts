import { clamp } from "@/lib/utils/utils";
import type { Point2D, Rect2D } from "@shift/types";
import { Mat } from "@shift/geo";
import {
  signal,
  computed,
  type WritableSignal,
  type Signal,
  type ComputedSignal,
} from "@/lib/reactive/signal";
import { SCREEN_HIT_RADIUS } from "../rendering/constants";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 32;
const PADDING = 300;

export class ViewportManager {
  private readonly $zoom: WritableSignal<number>;
  private readonly $panX: WritableSignal<number>;
  private readonly $panY: WritableSignal<number>;
  private readonly $upm: WritableSignal<number>;
  private readonly $descender: WritableSignal<number>;

  #canvasRect: Rect2D;
  #dpr: number;

  #mouseX: number;
  #mouseY: number;
  #pendingClientX: number;
  #pendingClientY: number;

  private readonly $screenMousePosition: WritableSignal<Point2D>;
  private readonly $upmToScreenMatrix: ComputedSignal<Mat>;
  private readonly $screenToUpmMatrix: ComputedSignal<Mat>;

  constructor() {
    this.$zoom = signal(1);
    this.$panX = signal(0);
    this.$panY = signal(0);
    this.$upm = signal(1000);
    this.$descender = signal(-200);

    this.#dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    this.#mouseX = 0;
    this.#mouseY = 0;
    this.#pendingClientX = 0;
    this.#pendingClientY = 0;
    this.$screenMousePosition = signal<Point2D>({ x: 0, y: 0 });

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

    this.$upmToScreenMatrix = computed(() => {
      const scale = this.upmScale;
      const baselineY = this.logicalHeight - PADDING - this.$descender.value * scale;
      const zoom = this.$zoom.value;

      const upmTransform = Mat.Identity().translate(PADDING, baselineY).scale(scale, -scale);

      const panX = this.$panX.value + this.centre.x * (1 - zoom);
      const panY = this.$panY.value + this.centre.y * (1 - zoom);
      const viewTransform = Mat.Identity().translate(panX, panY).scale(zoom, zoom);

      return Mat.Compose(viewTransform, upmTransform);
    });

    this.$screenToUpmMatrix = computed(() => {
      return Mat.Inverse(this.$upmToScreenMatrix.value);
    });
  }

  setRect(rect: Rect2D) {
    this.#canvasRect = rect;
    this.$upmToScreenMatrix.invalidate();
    this.$screenToUpmMatrix.invalidate();
  }

  get upm(): number {
    return this.$upm.value;
  }

  set upm(value: number) {
    this.$upm.value = value;
  }

  get descender(): number {
    return this.$descender.value;
  }

  set descender(value: number) {
    this.$descender.value = value;
  }

  get padding(): number {
    return PADDING;
  }

  get upmScale(): number {
    const availableHeight = this.logicalHeight - 2 * PADDING;
    if (availableHeight <= 0 || this.$upm.value <= 0) return 1;
    return availableHeight / this.$upm.value;
  }

  get deviceWidth(): number {
    return this.#canvasRect.width * this.#dpr;
  }

  get deviceHeight(): number {
    return this.#canvasRect.height * this.#dpr;
  }

  get logicalWidth(): number {
    return this.#canvasRect.width;
  }

  get logicalHeight(): number {
    return this.#canvasRect.height;
  }

  get dpr(): number {
    return this.#dpr;
  }

  public get zoom(): Signal<number> {
    return this.$zoom;
  }

  get centre(): Point2D {
    return { x: this.logicalWidth / 2, y: this.logicalHeight / 2 };
  }

  get pan(): Point2D {
    return { x: this.$panX.value, y: this.$panY.value };
  }

  get panX(): number {
    return this.$panX.value;
  }

  get panY(): number {
    return this.$panY.value;
  }

  get hitRadius(): number {
    return this.screenToUpmDistance(SCREEN_HIT_RADIUS);
  }

  get mousePosition(): Point2D {
    return this.projectScreenToUpm(this.#mouseX, this.#mouseY);
  }

  get screenMousePosition(): Signal<Point2D> {
    return this.$screenMousePosition;
  }

  getScreenMousePosition(): Point2D {
    return this.$screenMousePosition.peek();
  }

  updateMousePosition(clientX: number, clientY: number): void {
    this.#pendingClientX = clientX;
    this.#pendingClientY = clientY;
  }

  flushMousePosition(): void {
    this.#mouseX = Math.floor(this.#pendingClientX - this.#canvasRect.left);
    this.#mouseY = Math.floor(this.#pendingClientY - this.#canvasRect.top);
    this.$screenMousePosition.set({ x: this.#mouseX, y: this.#mouseY });
  }

  public projectScreenToUpm(x: number, y: number): Point2D {
    return Mat.applyToPoint(this.$screenToUpmMatrix.value, { x, y });
  }

  public projectUpmToScreen(x: number, y: number): Point2D {
    return Mat.applyToPoint(this.$upmToScreenMatrix.value, { x, y });
  }

  setPan(x: number, y: number): void {
    this.$panX.value = x;
    this.$panY.value = y;
  }

  public zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void {
    const before = this.projectScreenToUpm(screenX, screenY);

    const newZoom = clamp(this.$zoom.value * zoomDelta, MIN_ZOOM, MAX_ZOOM);
    this.$zoom.value = newZoom;

    const after = this.projectScreenToUpm(screenX, screenY);

    const scale = this.upmScale;
    const deltaX = (before.x - after.x) * scale * newZoom;
    const deltaY = (before.y - after.y) * scale * newZoom;

    this.$panX.value -= deltaX;
    this.$panY.value += deltaY;
  }

  zoomIn(): void {
    this.zoomToPoint(this.centre.x, this.centre.y, 1.25);
  }

  zoomOut(): void {
    this.zoomToPoint(this.centre.x, this.centre.y, 0.8);
  }

  public screenToUpmDistance(screenDistance: number): number {
    return screenDistance / (this.upmScale * this.$zoom.value);
  }
}
