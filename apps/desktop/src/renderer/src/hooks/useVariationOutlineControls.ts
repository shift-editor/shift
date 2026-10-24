import { useMemo } from "react";
import type { GlyphOutlineControls } from "@shift/editor/types";
import { useSignalState } from "@shift/editor/signals";
import { useEditor } from "@/workspace/WorkspaceContext";

/**
 * The Sources and Instances sections' outline controls, read from the editor's
 * comparison outlines.
 *
 * @returns Controls whose toggles change what the glyph node draws.
 */
export function useVariationOutlineControls() {
  const outlines = useEditor().nodeDefinition("glyph").outlines;
  const sources = useSignalState(outlines.sourcesCell);
  const instances = useSignalState(outlines.instancesCell);
  const visibility = useSignalState(outlines.visibilityCell);

  const sourceControls = useMemo<GlyphOutlineControls>(
    () => ({
      ...sources,
      groupActive: visibility.sourceGroupActive,
      onToggle: (target) => outlines.toggle(target),
      onToggleGroup: (targets) => outlines.toggleSourceGroup(targets),
    }),
    [outlines, sources, visibility.sourceGroupActive],
  );
  const instanceControls = useMemo<GlyphOutlineControls>(
    () => ({
      ...instances,
      groupActive: visibility.instanceGroupActive,
      onToggle: (target) => outlines.toggle(target),
      onToggleGroup: (targets) => outlines.toggleInstanceGroup(targets),
    }),
    [outlines, instances, visibility.instanceGroupActive],
  );

  return { sourceControls, instanceControls };
}
