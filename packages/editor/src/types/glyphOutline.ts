import type { NamedInstanceId, NodeId, SourceId } from "@shift/types";
import type { ExternalAxisLocation } from "@shift/editor/types/variation";

/** Identifies one variation location rendered as an outline around a glyph node. */
export type GlyphOutlineTarget =
  | { readonly kind: "source"; readonly sourceId: SourceId }
  | { readonly kind: "instance"; readonly instanceId: NamedInstanceId };

/** Render location resolved from a currently available outline target. */
export interface ResolvedGlyphOutlineTarget {
  readonly externalLocation: ExternalAxisLocation;
  readonly activeSourceId: SourceId | null;
}

/** Props shared by variation sections that edit one node's visible outlines. */
export interface GlyphOutlineControls {
  readonly targets: readonly GlyphOutlineTarget[];
  readonly inheritedTargets: readonly GlyphOutlineTarget[];
  readonly groupActive: boolean;
  readonly onToggle: (target: GlyphOutlineTarget) => void;
  readonly onToggleGroup: (targets: readonly GlyphOutlineTarget[]) => void;
}

/** Node-scoped outline collection exposed by the glyph node definition. */
export type GlyphOutlinesByNode = ReadonlyMap<NodeId, readonly GlyphOutlineTarget[]>;
