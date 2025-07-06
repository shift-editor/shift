import { FontEngine as FontEngineType } from "@/types/electron";

export class FontEngine {
  #instance: FontEngineType;

  constructor() {
    this.#instance = window.shiftFont;
  }

  public loadFont(path: string) {
    return this.#instance.loadFont(path);
  }

  public getFontFamily() {
    return this.#instance.getFontFamily();
  }

  public getFontStyle() {
    return this.#instance.getFontStyle();
  }

  public getMetrics() {
    return this.#instance.getMetrics();
  }
}
