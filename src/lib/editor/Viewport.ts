import { clamp } from "@/lib/utils/utils";
import { Point2D, Rect2D } from "@/types/math";

export class Viewport {
  #padding: number;
  #upm: number;
  #canvasRect: Rect2D;

  #zoom: number;
  #dpr: number;

  #panX: number;
  #panY: number;

  #mouseX: number;
  #mouseY: number;

  #upmX: number;
  #upmY: number;

  constructor() {
    this.#upm = 1000;
    this.#padding = 300;

    this.#dpr = window.devicePixelRatio || 1;
    this.#zoom = 1;

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

    this.#panX = 0;
    this.#panY = 0;
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
    return this.#upm;
  }

  get padding(): number {
    return this.#padding;
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
    return this.#zoom;
  }

  // **
  // Get the device pixel ratio of the viewport
  // @returns The device pixel ratio of the viewport
  // **
  get dpr(): number {
    return this.#dpr;
  }

  public get zoom(): number {
    return this.#zoom;
  }

  // **
  // Get the mouse position of the viewport
  // @returns The mouse position of the viewport
  // **
  calculateMousePosition(clientX: number, clientY: number): Point2D {
    const mouseX = clientX - this.#canvasRect.left;
    const mouseY = clientY - this.#canvasRect.top;

    this.#mouseX = Math.floor(mouseX);
    this.#mouseY = Math.floor(mouseY);

    return {
      x: this.#mouseX,
      y: this.#mouseY,
    };
  }

  public setMousePosition(clientX: number, clientY: number): Point2D {
    const { x, y } = this.calculateMousePosition(clientX, clientY);
    this.#mouseX = x;
    this.#mouseY = y;

    return { x, y };
  }

  public getMousePosition(clientX?: number, clientY?: number): Point2D {
    if (clientX && clientY) {
      return this.calculateMousePosition(clientX, clientY);
    }

    return { x: this.#mouseX, y: this.#mouseY };
  }

  projectScreenToUpm(x: number, y: number) {
    const center = this.getCentrePoint();
    const zoomedX =
      (x - (this.#panX + center.x * (1 - this.#zoom))) / this.#zoom;
    const zoomedY =
      (y - (this.#panY + center.y * (1 - this.#zoom))) / this.#zoom;

    const upmX = Math.floor(zoomedX - this.#padding);
    const upmY = Math.floor(-zoomedY + (this.logicalHeight - this.#padding));

    return { x: upmX, y: upmY };
  }

  projectUpmToScreen(x: number, y: number) {
    x = x + this.#padding;

    y = -(y - (this.logicalHeight - this.#padding));

    const panX = this.#panX + this.getCentrePoint().x * (1 - this.#zoom);
    const panY = this.#panY + this.getCentrePoint().y * (1 - this.#zoom);

    x = x * this.#zoom + panX;
    y = y * this.#zoom + panY;

    return { x, y };
  }

  // **
  // Get the upm mouse position of the viewport
  // @returns The upm mouse position of the viewport
  // **
  calculateUpmMousePosition(clientX: number, clientY: number): Point2D {
    const canvasX = clientX - this.#canvasRect.left;
    const canvasY = clientY - this.#canvasRect.top;

    const { x, y } = this.projectScreenToUpm(canvasX, canvasY);
    this.#upmX = x;

    return { x, y };
  }

  public setUpmMousePosition(clientX: number, clientY: number): Point2D {
    const { x, y } = this.calculateUpmMousePosition(clientX, clientY);
    this.#upmX = x;
    this.#upmY = y;

    return { x, y };
  }

  public getUpmMousePosition(clientX?: number, clientY?: number): Point2D {
    if (clientX && clientY) {
      return this.calculateUpmMousePosition(clientX, clientY);
    }

    return { x: this.#upmX, y: this.#upmY };
  }

  public getCentrePoint(): Point2D {
    return { x: this.logicalWidth / 2, y: this.logicalHeight / 2 };
  }

  get panX(): number {
    return this.#panX;
  }

  get panY(): number {
    return this.#panY;
  }

  // **
  // Pan the viewport
  // @param x - The x position of the mouse
  // @param y - The y position of the mouse
  // **
  pan(x: number, y: number): void {
    this.#panX = x;
    this.#panY = y;
  }

  zoomIn(): void {
    this.#zoom = clamp(this.#zoom + 0.5, 0.1, 6);
  }

  zoomOut(): void {
    this.#zoom = clamp(this.#zoom - 0.5, 0.1, 6);
  }
}
