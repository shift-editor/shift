import { Contour } from "./Contour";

export class Glyph {
  #name: string;
  #contours: Contour[];

  constructor(name: string, contours: Contour[]) {
    this.#name = name;
    this.#contours = contours;
  }

  get name(): string {
    return this.#name;
  }

  get contours(): Contour[] {
    return this.#contours;
  }
}
