import type { GlyphOutlineTarget } from "@shift/editor/types";
import type { NamedInstanceId, SourceId } from "@shift/types";

export interface OutlineGroup<Id> {
  readonly explicitIds: ReadonlySet<Id>;
  readonly groupIds: ReadonlySet<Id>;
  readonly groupActive: boolean;
}

export interface VariationOutlineState {
  readonly sources: OutlineGroup<SourceId>;
  readonly instances: OutlineGroup<NamedInstanceId>;
  readonly hiddenSelectedSourceIds: ReadonlySet<SourceId>;
}

export type VariationOutlineAction =
  | { readonly type: "toggleSource"; readonly sourceId: SourceId; readonly selected: boolean }
  | { readonly type: "toggleSourceGroup"; readonly sourceIds: readonly SourceId[] }
  | { readonly type: "toggleInstance"; readonly instanceId: NamedInstanceId }
  | {
      readonly type: "toggleInstanceGroup";
      readonly instanceIds: readonly NamedInstanceId[];
    }
  | {
      readonly type: "reconcileSelectedSources";
      readonly selectedIds: ReadonlySet<SourceId>;
    };

/** Outline targets derived for one variation section, in render order. */
export interface OutlineTargetSet<Id> {
  /** Visible targets: explicit first, then selected editing sources, then the group. */
  readonly targets: readonly GlyphOutlineTarget[];
  /** Targets the section's show-all group currently contributes. */
  readonly inheritedTargets: readonly GlyphOutlineTarget[];
  /** Identities of every visible target. */
  readonly visibleIds: ReadonlySet<Id>;
}
