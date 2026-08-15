import type { FontIntent, GlyphState } from "@shift/types";
import type { GlyphPositions } from "@shift/glyph-state";

declare const WorkspaceEditIdBrand: unique symbol;

/** Renderer-local correlation identity; never crosses the workspace boundary. */
export type WorkspaceEditId = number & {
  readonly [WorkspaceEditIdBrand]: typeof WorkspaceEditIdBrand;
};

/** One renderer edit matching one workspace apply and one undo entry. */
export interface WorkspaceEdit {
  readonly id: WorkspaceEditId;
  readonly intents: FontIntent[];
  readonly label?: string;
}

export type LocalLayerUpdate =
  | {
      /** Sparse numeric update preserving the reactive buffer container. */
      readonly kind: "patch";
      readonly positions: GlyphPositions;
      readonly xAdvance: number | null;
    }
  | {
      /** Complete predicted state required after a structural edit. */
      readonly kind: "replace";
      readonly state: GlyphState;
    };

export type WorkspaceApplyStatus = "idle" | "queued" | "applying";
