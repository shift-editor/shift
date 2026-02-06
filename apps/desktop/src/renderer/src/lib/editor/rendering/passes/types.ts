import type { IRenderer } from "@/types/graphics";

export interface RenderContext {
  ctx: IRenderer;
  lineWidthUpm: (screenPx?: number) => number;
}
