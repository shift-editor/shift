export class CanvasManager {
  #width: number;
  #height: number;

  #mouseX: number;
  #mouseY: number;

  constructor() {
    this.#mouseX = 0;
    this.#mouseY = 0;
    this.#width = 0;
    this.#height = 0;
  }

  public get mouseX(): number {
    return this.#mouseX;
  }

  public get mouseY(): number {
    return this.#mouseY;
  }

  public set mouseX(x: number) {
    this.#mouseX = x;
  }

  public set mouseY(y: number) {
    this.#mouseY = y;
  }

  public get mousePosition(): { x: number; y: number } {
    return { x: this.#mouseX, y: this.#mouseY };
  }

  public get width(): number {
    return this.#width;
  }

  public get height(): number {
    return this.#height;
  }

  public set width(width: number) {
    if (width < 0) {
      throw new Error("Width cannot be negative");
    }

    this.#width = width;
  }

  public set height(height: number) {
    if (height < 0) {
      throw new Error("Height cannot be negative");
    }

    this.#height = height;
  }

  public setDimensions(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}
