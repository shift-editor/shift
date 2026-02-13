import type { Point2D } from "@shift/types";
import type { IRenderer } from "@/types/graphics";
import type { EditorAPI } from "./EditorAPI";
import type { DrawAPI } from "./DrawAPI";

export type ToolRenderLayer =
  | "static-scene-before-handles"
  | "static-screen-after-handles"
  | "interactive-scene";

export type ToolRenderVisibility = "always" | "active-only";

export interface ToolRenderContext {
  readonly editor: EditorAPI;
  readonly draw?: DrawAPI;
  readonly renderer?: IRenderer;
  readonly lineWidthUpm: (pixels?: number) => number;
  readonly projectGlyphLocalToScreen: (point: Point2D) => Point2D;
}

export interface ToolRenderContributor {
  readonly id: string;
  readonly layer: ToolRenderLayer;
  readonly visibility?: ToolRenderVisibility;
  render(ctx: ToolRenderContext): void;
}
