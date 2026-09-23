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
