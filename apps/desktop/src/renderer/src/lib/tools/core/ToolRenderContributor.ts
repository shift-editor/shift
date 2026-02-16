import type { Point2D } from "@shift/types";
import type { IRenderer } from "@/types/graphics";
import type { EditorAPI } from "./EditorAPI";
import type { DrawAPI } from "./DrawAPI";
import type { DrawStyle } from "@/lib/styles/style";

export type ToolRenderLayer =
  | "static-scene-before-handles"
  | "static-screen-after-handles"
  | "interactive-scene";

export type ToolRenderVisibility = "always" | "active-only";

export interface ToolRenderContext {
  readonly editor: EditorAPI;
  readonly draw?: DrawAPI;
  readonly renderer?: IRenderer;
  readonly pxToUpm: (pixels?: number) => number;
  readonly applyStyle: (renderer: IRenderer, style: DrawStyle) => void;
  readonly projectGlyphLocalToScreen: (point: Point2D) => Point2D;
}

export interface ToolRenderContributor {
  readonly id: string;
  readonly layer: ToolRenderLayer;
  readonly visibility?: ToolRenderVisibility;
  render(ctx: ToolRenderContext): void;
}
