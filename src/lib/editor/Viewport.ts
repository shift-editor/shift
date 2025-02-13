import { Point2D, Rect2D, TransformMatrix } from "@/types/math";

export class Viewport {
  #padding: number;
  #upm: number;
  #canvasRect: Rect2D;

  #zoom: number;
  #dpr: number;

  #mouseX: number;
  #mouseY: number;

  #panX: number;
  #panY: number;

  constructor() {
    this.#upm = 1000;
    this.#padding = 300;

    this.#dpr = window.devicePixelRatio || 1;
    this.#zoom = 1;

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

    this.#mouseX = 0;
    this.#mouseY = 0;

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
  public mousePosition(clientX: number, clientY: number): Point2D {
    return {
      x: clientX - this.#canvasRect.left,
      y: clientY - this.#canvasRect.top,
    };
  }

  public getCentrePoint(): Point2D {
    return { x: this.logicalWidth / 2, y: this.logicalHeight / 2 };
  }

  // **
  // Get the upm mouse position of the viewport
  // @returns The upm mouse position of the viewport
  // **
  upmMousePosition(): Point2D {
    return { x: 0, y: 0 };
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
    this.#zoom += 0.5;
  }

  zoomOut(): void {
    this.#zoom -= 0.5;
  }
}
