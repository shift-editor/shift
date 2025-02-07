import { IRenderer } from "@/types/graphics";

export class Painter {
  constructor() {}

  drawStatic(ctx: IRenderer) {
    ctx.drawCircle(1000, 500, 50);
    ctx.flush();
  }

  drawInteractive(ctx: IRenderer): void {}

  public draw(ctx: IRenderer): void {
    this.drawStatic(ctx);
    this.drawInteractive(ctx);
  }
}
