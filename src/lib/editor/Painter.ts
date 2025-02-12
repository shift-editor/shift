import { IRenderer } from "@/types/graphics";

import type { IPath } from "@/types/graphics";

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

  setStaticGuides(ctx: IRenderer) {
    const path = ctx.createPath();

    path.moveTo(0, GUIDES.descender.y);
    path.lineTo(X_ADVANCE, GUIDES.descender.y);
    path.lineTo(X_ADVANCE, 200);

    path.lineTo(0, 200);
    path.lineTo(0, GUIDES.descender.y);

    path.moveTo(0, 200);

    path.lineTo(0, GUIDES.xHeight.y);
    path.lineTo(X_ADVANCE, GUIDES.xHeight.y);
    path.lineTo(X_ADVANCE, 200);

    path.moveTo(X_ADVANCE, GUIDES.xHeight.y);
    path.lineTo(X_ADVANCE, GUIDES.capHeight.y);

    path.lineTo(0, GUIDES.capHeight.y);
    path.lineTo(0, GUIDES.xHeight.y);

    this.#staticGuides = path;
  }

  public drawStatic(ctx: IRenderer) {
    ctx.strokeStyle = "rgba(76, 96, 230, 0.75)";
    if (!this.#staticGuides) {
      console.error("No static guides set");
      return;
    }
    ctx.stroke(this.#staticGuides);
  }

  public drawInteractive(_: IRenderer): void {}
}
