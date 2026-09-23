import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { GlyphOutlineControls, GlyphOutlineTarget } from "@shift/editor/types";
import type { SourceId } from "@shift/types";
import { createVariationOutlineState, variationOutlineReducer } from "@/lib/variationOutlineState";

/**
 * Derives variation-outline controls from one reducer-owned visibility model.
 *
 * @param activeSourceId - Source rendered as the editable foreground and therefore never outlined.
 * @param editingSourceIds - Sources whose comparison outlines are visible unless individually hidden.
 * @returns Stable source and instance controls plus their combined render targets.
 */
export function useVariationOutlineControls(
  activeSourceId: SourceId | null,
  editingSourceIds: ReadonlySet<SourceId>,
) {
  const [state, dispatch] = useReducer(
    variationOutlineReducer,
    undefined,
    createVariationOutlineState,
  );

  useEffect(() => {
    dispatch({
      type: "reconcileSelectedSources",
      selectedIds: new Set(
        Array.from(editingSourceIds).filter((sourceId) => sourceId !== activeSourceId),
      ),
    });
  }, [activeSourceId, editingSourceIds]);

  const sources = useMemo(() => {
    const explicitTargets = Array.from(state.sources.explicitIds)
      .filter((sourceId) => sourceId !== activeSourceId)
      .map((sourceId): GlyphOutlineTarget => ({ kind: "source", sourceId }));
    const explicitIds = new Set(
      explicitTargets.flatMap((target) => (target.kind === "source" ? [target.sourceId] : [])),
    );
    const selectedTargets = Array.from(editingSourceIds)
      .filter(
        (sourceId) =>
          sourceId !== activeSourceId &&
          !state.hiddenSelectedSourceIds.has(sourceId) &&
          !explicitIds.has(sourceId),
      )
      .map((sourceId): GlyphOutlineTarget => ({ kind: "source", sourceId }));
    const visibleIds = new Set([
      ...explicitIds,
      ...selectedTargets.flatMap((target) => (target.kind === "source" ? [target.sourceId] : [])),
    ]);
    const groupTargets = Array.from(state.sources.groupIds)
      .filter((sourceId) => sourceId !== activeSourceId && !visibleIds.has(sourceId))
      .map((sourceId): GlyphOutlineTarget => ({ kind: "source", sourceId }));

    for (const target of groupTargets) {
      if (target.kind === "source") visibleIds.add(target.sourceId);
    }

    return {
      targets: [...explicitTargets, ...selectedTargets, ...groupTargets],
      inheritedTargets: Array.from(state.sources.groupIds).map(
        (sourceId): GlyphOutlineTarget => ({ kind: "source", sourceId }),
      ),
      visibleIds,
    };
  }, [activeSourceId, editingSourceIds, state.hiddenSelectedSourceIds, state.sources]);

  const instances = useMemo(() => {
    const explicitTargets = Array.from(state.instances.explicitIds).map(
      (instanceId): GlyphOutlineTarget => ({ kind: "instance", instanceId }),
    );
    const visibleIds = new Set(state.instances.explicitIds);
    const groupTargets = Array.from(state.instances.groupIds)
      .filter((instanceId) => !visibleIds.has(instanceId))
      .map((instanceId): GlyphOutlineTarget => ({ kind: "instance", instanceId }));

    for (const target of groupTargets) {
      if (target.kind === "instance") visibleIds.add(target.instanceId);
    }

    return {
      targets: [...explicitTargets, ...groupTargets],
      inheritedTargets: Array.from(state.instances.groupIds).map(
        (instanceId): GlyphOutlineTarget => ({ kind: "instance", instanceId }),
      ),
      visibleIds,
    };
  }, [state.instances]);

  const toggleSource = useCallback(
    (target: GlyphOutlineTarget) => {
      if (target.kind !== "source" || target.sourceId === activeSourceId) return;

      dispatch({
        type: "toggleSource",
        sourceId: target.sourceId,
        selected: editingSourceIds.has(target.sourceId),
      });
    },
    [activeSourceId, editingSourceIds],
  );

  const toggleSourceGroup = useCallback(
    (targets: readonly GlyphOutlineTarget[]) => {
      dispatch({
        type: "toggleSourceGroup",
        sourceIds: targets.flatMap((target) =>
          target.kind === "source" && !sources.visibleIds.has(target.sourceId)
            ? [target.sourceId]
            : [],
        ),
      });
    },
    [sources.visibleIds],
  );

  const toggleInstance = useCallback((target: GlyphOutlineTarget) => {
    if (target.kind !== "instance") return;

    dispatch({ type: "toggleInstance", instanceId: target.instanceId });
  }, []);

  const toggleInstanceGroup = useCallback(
    (targets: readonly GlyphOutlineTarget[]) => {
      dispatch({
        type: "toggleInstanceGroup",
        instanceIds: targets.flatMap((target) =>
          target.kind === "instance" && !instances.visibleIds.has(target.instanceId)
            ? [target.instanceId]
            : [],
        ),
      });
    },
    [instances.visibleIds],
  );

  const sourceControls = useMemo<GlyphOutlineControls>(
    () => ({
      targets: sources.targets,
      inheritedTargets: sources.inheritedTargets,
      groupActive: state.sources.groupActive,
      onToggle: toggleSource,
      onToggleGroup: toggleSourceGroup,
    }),
    [sources, state.sources.groupActive, toggleSource, toggleSourceGroup],
  );
  const instanceControls = useMemo<GlyphOutlineControls>(
    () => ({
      targets: instances.targets,
      inheritedTargets: instances.inheritedTargets,
      groupActive: state.instances.groupActive,
      onToggle: toggleInstance,
      onToggleGroup: toggleInstanceGroup,
    }),
    [instances, state.instances.groupActive, toggleInstance, toggleInstanceGroup],
  );

  const targets = useMemo(
    () => [...sources.targets, ...instances.targets],
    [instances.targets, sources.targets],
  );

  return { sourceControls, instanceControls, targets };
}
