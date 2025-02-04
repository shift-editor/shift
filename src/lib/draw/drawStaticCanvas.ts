import { IRenderer } from "@/types/graphics";

export function drawStaticCanvas(ctx: IRenderer) {
  ctx.drawLine(0, 0, 100, 100);
}
