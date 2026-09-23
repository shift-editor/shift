import { useEffect } from "react";
import type { GlyphOutlineTarget } from "@shift/editor/types";
import type { NodeId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";

/**
 * Synchronizes session-only comparison outlines with one mounted glyph node.
 *
 * @param glyphNodeId - Scene occurrence receiving outlines, or `null` while no glyph is mounted.
 * @param targets - Complete ordered outline collection for the current render.
 */
export function useGlyphOutlineTargets(
  glyphNodeId: NodeId | null,
  targets: readonly GlyphOutlineTarget[],
): void {
  const editor = useEditor();
  const outlines = editor.nodeDefinition("glyph").outlines;

  useEffect(() => {
    if (!glyphNodeId) return;

    outlines.set(glyphNodeId, targets);
  }, [glyphNodeId, outlines, targets]);

  useEffect(() => {
    if (!glyphNodeId) return;

    return () => outlines.clear(glyphNodeId);
  }, [glyphNodeId, outlines]);
}
