import { Point2D, TransformMatrix } from "@/types/math";

export class Viewport {
  #upm: number;
  #logicalWidth: number;
  #logicalHeight: number;

  #zoom: number;
  #dpr: number;

  #mouseX: number;
  #mouseY: number;

  #panX: number;
  #panY: number;

  constructor() {
    this.#upm = 1000;

    this.#dpr = window.devicePixelRatio || 1;
    this.#zoom = 1;

    this.#logicalWidth = 0;
    this.#logicalHeight = 0;

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
  setDimensions(width: number, height: number) {
    this.#logicalWidth = width;
    this.#logicalHeight = height;
  }

  // **
  // Get the upm of the viewport
  // @returns The upm of the viewport
  // **
  get upm(): number {
    return this.#upm;
  }

  // **
  // Get the device width of the viewport,
  // scaled to the device pixel ratio
  // @returns The device width of the viewport
  // **
  get deviceWidth(): number {
    return this.#logicalWidth * this.#dpr;
  }

  // **
  // Get the device height of the viewport,
  // scaled to the device pixel ratio
  // @returns The device height of the viewport
  // **
  get deviceHeight(): number {
    return this.#logicalHeight * this.#dpr;
  }

  // **
  // Get the logical width of the viewport
  // @returns The logical width of the viewport
  // **
  get logicalWidth(): number {
    return this.#logicalWidth;
  }

  // **
  // Get the logical height of the viewport
  // @returns The logical height of the viewport
  // **
  get logicalHeight(): number {
    return this.#logicalHeight;
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
  // Set the mouse position of the viewport
  // @param x - The x position of the mouse
  // @param y - The y position of the mouse
  // **
  setMousePosition(x: number, y: number) {
    this.#mouseX = x;
    this.#mouseY = y;
  }

  // **
  // Get the mouse position of the viewport
  // @returns The mouse position of the viewport
  // **
  public mousePosition(): Point2D {
    return { x: this.#mouseX, y: this.#mouseY };
  }

  public getCentrePoint(): Point2D {
    return { x: this.logicalWidth / 2, y: this.logicalHeight / 2 };
  }

  // **
  // Get the upm mouse position of the viewport
  // @returns The upm mouse position of the viewport
  // **
  upmMousePosition(): Point2D {
    const y = this.#mouseY + 300 + this.#logicalWidth / this.#upm;
    const x = this.#mouseX + 300 + this.#logicalHeight / this.#upm;

    return { x, y };
  }

  // **
  // Get the upm transform matrix of the viewport
  // @returns The upm transform matrix of the viewport scaled to the device pixel ratio
  // **
  upmTransformMatrix(): TransformMatrix {
    const upmWidth = (this.logicalWidth - 300) / this.upm;
    const upmHeight = (this.logicalHeight - 300) / this.upm;

    const scale = Math.min(upmWidth, upmHeight);

    const midPointX = this.#logicalWidth / 2 - (scale * this.upm) / 2;
    const midPointY =
      this.#logicalHeight - (this.#logicalHeight / 2 - (scale * this.upm) / 2);

    return [scale, 0, 0, -scale, midPointX, midPointY];
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
