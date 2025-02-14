import { IRenderer } from "@/types/graphics";

import { GUIDE_STYLES } from "../gfx/styles/style";

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

    Object.values(GUIDES).forEach(({ y }) => {
      path.moveTo(0, y);
      path.lineTo(X_ADVANCE, y);
    });

    // Draw vertical bounds
    path.moveTo(0, GUIDES.descender.y);
    path.lineTo(0, GUIDES.ascender.y);
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
}
