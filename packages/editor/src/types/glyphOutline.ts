import type { NamedInstanceId, SourceId } from "@shift/types";
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

/** Outline targets derived for one variation section, in render order. */
export interface OutlineTargetSet {
  /** Visible targets: row-chosen first, then sources being edited, then show-all's. */
  readonly targets: OutlineTargets;
  /** Targets the section's show-all button currently contributes. */
  readonly inheritedTargets: OutlineTargets;
}

/** Props shared by variation sections that edit one node's visible outlines. */
export interface GlyphOutlineControls {
  readonly targets: OutlineTargets;
  readonly inheritedTargets: OutlineTargets;
  readonly groupActive: boolean;
  readonly onToggle: (target: GlyphOutlineTarget) => void;
  readonly onToggleGroup: (targets: OutlineTargets) => void;
}
