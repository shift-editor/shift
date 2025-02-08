import { IRenderer } from "@/types/graphics";

import { Viewport } from "./Viewport";

export class Painter {
  #viewport: Viewport;

  constructor(viewport: Viewport) {
    this.#viewport = viewport;
  }

  drawStatic(ctx: IRenderer) {
    const centrePoint = this.#viewport.getCentrePoint();
    ctx.drawCircle(centrePoint.x, centrePoint.y, 50);
  }

  drawInteractive(_: IRenderer): void {}

  public draw(ctx: IRenderer): void {
    this.drawStatic(ctx);
    this.drawInteractive(ctx);

    ctx.flush();
  }
}
