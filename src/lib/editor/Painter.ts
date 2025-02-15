import {
  GUIDE_STYLES,
  SELECTION_RECTANGLE_STYLES,
} from "@/lib/gfx/styles/style";
import { IPath, IRenderer } from "@/types/graphics";

const X_ADVANCE = 600;

const GUIDES = {
  ascender: { y: 750 },
  capHeight: { y: 700 },
  xHeight: { y: 500 },
  baseline: { y: 0 },
  descender: { y: -200 },
};

export class Painter {
  #staticGuides: IPath | null = null;
  #pixelOffset: number;

  constructor() {
    this.#pixelOffset = 0;
  }

  setPixelOffset(lineWidth: number) {
    if (lineWidth % 2 === 0 && Number.isInteger(lineWidth)) return;

    this.#pixelOffset = lineWidth / 2;
  }

  setStaticGuides(ctx: IRenderer) {
    const path = ctx.createPath();

    Object.values(GUIDES).forEach(({ y }) => {
      path.moveTo(this.#pixelOffset, y);
      path.lineTo(X_ADVANCE, y);
    });

    path.moveTo(this.#pixelOffset, GUIDES.descender.y);
    path.lineTo(this.#pixelOffset, GUIDES.ascender.y);
    path.moveTo(X_ADVANCE, GUIDES.descender.y);
    path.lineTo(X_ADVANCE, GUIDES.ascender.y);

    this.#staticGuides = path;
  }

  public drawStatic(ctx: IRenderer) {
    if (!this.#staticGuides) {
      console.error("No static guides set");
      return;
    }

    ctx.setStyle(GUIDE_STYLES);
    ctx.stroke(this.#staticGuides);
  }

  public drawInteractive(_: IRenderer): void {}

  public drawSelectionRectangle(
    ctx: IRenderer,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const rx = x;
    const ry = y;
    const rw = w;
    const rh = h;

    ctx.setStyle({
      ...SELECTION_RECTANGLE_STYLES,
      strokeStyle: "transparent",
    });
    ctx.fillRect(rx, ry, rw, rh);

    // Stroke second
    ctx.setStyle({
      ...SELECTION_RECTANGLE_STYLES,
      fillStyle: "transparent",
    });
    ctx.strokeRect(rx, ry, rw, rh);
  }
}
