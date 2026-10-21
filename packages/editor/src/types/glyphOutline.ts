import type { NamedInstanceId, NodeId, SourceId } from "@shift/types";
import type { OutlineTargets } from "../lib/nodes/OutlineTargets";
import type { ExternalAxisLocation } from "./variation";

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
  readonly targets: OutlineTargets;
  readonly inheritedTargets: OutlineTargets;
  readonly groupActive: boolean;
  readonly onToggle: (target: GlyphOutlineTarget) => void;
  readonly onToggleGroup: (targets: OutlineTargets) => void;
}

/** Node-scoped outline collection exposed by the glyph node definition. */
export type GlyphOutlinesByNode = ReadonlyMap<NodeId, readonly GlyphOutlineTarget[]>;
