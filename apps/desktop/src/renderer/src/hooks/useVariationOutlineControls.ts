import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { OutlineTargets } from "@shift/editor/model";
import type { GlyphOutlineControls, GlyphOutlineTarget } from "@shift/editor/types";
import type { SourceId } from "@shift/types";
import {
  createVariationOutlineState,
  instanceOutlineTargets,
  sourceOutlineTargets,
  variationOutlineReducer,
} from "@/lib/variationOutlineState";

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

  const sources = useMemo(
    () => sourceOutlineTargets(state, activeSourceId, editingSourceIds),
    [activeSourceId, editingSourceIds, state],
  );
  const instances = useMemo(() => instanceOutlineTargets(state), [state]);

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
    (targets: OutlineTargets) => {
      dispatch({
        type: "toggleSourceGroup",
        sourceIds: targets.sources().filter((sourceId) => !sources.targets.hasSource(sourceId)),
      });
    },
    [sources.targets],
  );

  const toggleInstance = useCallback((target: GlyphOutlineTarget) => {
    if (target.kind !== "instance") return;

    dispatch({ type: "toggleInstance", instanceId: target.instanceId });
  }, []);

  const toggleInstanceGroup = useCallback(
    (targets: OutlineTargets) => {
      dispatch({
        type: "toggleInstanceGroup",
        instanceIds: targets
          .instances()
          .filter((instanceId) => !instances.targets.hasInstance(instanceId)),
      });
    },
    [instances.targets],
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
    () => sources.targets.concat(instances.targets),
    [instances.targets, sources.targets],
  );

  return { sourceControls, instanceControls, targets };
}
