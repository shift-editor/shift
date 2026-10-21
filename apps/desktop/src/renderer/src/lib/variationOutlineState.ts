import type { NamedInstanceId, SourceId } from "@shift/types";
import { OutlineTargets } from "@shift/editor/model";
import type {
  OutlineGroup,
  OutlineTargetSet,
  VariationOutlineAction,
  VariationOutlineState,
} from "@/types/variationOutline";

function emptyGroup<Id>(): OutlineGroup<Id> {
  return {
    explicitIds: new Set(),
    groupIds: new Set(),
    groupActive: false,
  };
}

export function createVariationOutlineState(): VariationOutlineState {
  return {
    sources: emptyGroup<SourceId>(),
    instances: emptyGroup<NamedInstanceId>(),
    hiddenSelectedSourceIds: new Set(),
  };
}

export function variationOutlineReducer(
  state: VariationOutlineState,
  action: VariationOutlineAction,
): VariationOutlineState {
  switch (action.type) {
    case "toggleSource": {
      const explicit = state.sources.explicitIds.has(action.sourceId);
      const selected =
        !explicit && action.selected && !state.hiddenSelectedSourceIds.has(action.sourceId);
      const inherited = !explicit && (selected || state.sources.groupIds.has(action.sourceId));

      if (inherited) {
        const hiddenSelectedSourceIds = new Set(state.hiddenSelectedSourceIds);
        if (action.selected) hiddenSelectedSourceIds.add(action.sourceId);

        const groupIds = new Set(state.sources.groupIds);
        groupIds.delete(action.sourceId);

        return {
          ...state,
          sources: { ...state.sources, groupIds },
          hiddenSelectedSourceIds,
        };
      }

      if (explicit) {
        const explicitIds = new Set(state.sources.explicitIds);
        explicitIds.delete(action.sourceId);
        const groupIds = new Set(state.sources.groupIds);
        groupIds.delete(action.sourceId);
        const hiddenSelectedSourceIds = new Set(state.hiddenSelectedSourceIds);
        if (action.selected) hiddenSelectedSourceIds.add(action.sourceId);

        return {
          ...state,
          sources: { ...state.sources, explicitIds, groupIds },
          hiddenSelectedSourceIds,
        };
      }

      const explicitIds = new Set(state.sources.explicitIds).add(action.sourceId);
      const hiddenSelectedSourceIds = new Set(state.hiddenSelectedSourceIds);
      hiddenSelectedSourceIds.delete(action.sourceId);

      return {
        ...state,
        sources: { ...state.sources, explicitIds },
        hiddenSelectedSourceIds,
      };
    }

    case "toggleSourceGroup":
      return {
        ...state,
        sources: state.sources.groupActive
          ? { ...state.sources, groupIds: new Set(), groupActive: false }
          : { ...state.sources, groupIds: new Set(action.sourceIds), groupActive: true },
      };

    case "toggleInstance": {
      const inherited = state.instances.groupIds.has(action.instanceId);
      if (inherited) {
        const groupIds = new Set(state.instances.groupIds);
        groupIds.delete(action.instanceId);
        return { ...state, instances: { ...state.instances, groupIds } };
      }

      const explicitIds = new Set(state.instances.explicitIds);
      if (explicitIds.has(action.instanceId)) {
        explicitIds.delete(action.instanceId);
      } else {
        explicitIds.add(action.instanceId);
      }

      return { ...state, instances: { ...state.instances, explicitIds } };
    }

    case "toggleInstanceGroup":
      return {
        ...state,
        instances: state.instances.groupActive
          ? { ...state.instances, groupIds: new Set(), groupActive: false }
          : { ...state.instances, groupIds: new Set(action.instanceIds), groupActive: true },
      };

    case "reconcileSelectedSources": {
      const hiddenSelectedSourceIds = new Set(
        Array.from(state.hiddenSelectedSourceIds).filter((sourceId) =>
          action.selectedIds.has(sourceId),
        ),
      );
      if (hiddenSelectedSourceIds.size === state.hiddenSelectedSourceIds.size) return state;

      return { ...state, hiddenSelectedSourceIds };
    }
  }
}

/**
 * Derives the visible source outlines for the current editing selection.
 *
 * @param state - Reducer-owned outline visibility intent.
 * @param activeSourceId - Editable foreground source, which is never outlined.
 * @param editingSourceIds - Sources whose outlines are visible unless individually hidden.
 * @returns Source targets without duplicates, explicit targets first.
 */
export function sourceOutlineTargets(
  state: VariationOutlineState,
  activeSourceId: SourceId | null,
  editingSourceIds: ReadonlySet<SourceId>,
): OutlineTargetSet {
  const shownEditingIds = editingSourceIds
    .values()
    .filter((sourceId) => !state.hiddenSelectedSourceIds.has(sourceId));
  const visibleIds = [
    ...state.sources.explicitIds,
    ...shownEditingIds,
    ...state.sources.groupIds,
  ].filter((sourceId) => sourceId !== activeSourceId);

  return {
    targets: OutlineTargets.sources(visibleIds),
    inheritedTargets: OutlineTargets.sources(state.sources.groupIds),
  };
}

/**
 * Derives the visible named-instance outlines.
 *
 * @param state - Reducer-owned outline visibility intent.
 * @returns Instance targets without duplicates, explicit targets first.
 */
export function instanceOutlineTargets(state: VariationOutlineState): OutlineTargetSet {
  return {
    targets: OutlineTargets.instances([
      ...state.instances.explicitIds,
      ...state.instances.groupIds,
    ]),
    inheritedTargets: OutlineTargets.instances(state.instances.groupIds),
  };
}
