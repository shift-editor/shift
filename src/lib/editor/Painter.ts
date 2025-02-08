import { IRenderer } from "@/types/graphics";

export class Painter {
  constructor() {}

  drawStatic(ctx: IRenderer) {
    ctx.drawCircle(1000, 500, 100);
  }

  drawInteractive(_: IRenderer): void {}

  public draw(ctx: IRenderer): void {
    this.drawStatic(ctx);
    this.drawInteractive(ctx);

    ctx.flush();
  }
}
