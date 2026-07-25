import { computed, useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useMemo } from "react";

export interface GlyphXAdvanceState {
  readonly xAdvance: number;
  readonly hasLayer: boolean;
}

/**
 * Current glyph xAdvance, live-updating. Returns `0` when no glyph is loaded.
 */
export function useGlyphXAdvance(): GlyphXAdvanceState {
  const editor = useEditor();
  const xAdvanceCell = useMemo(
    () =>
      computed(() => {
        const glyphNodes = editor.scene.cell.value.nodes.filter((node) => node.kind === "glyph");
        const node = glyphNodes.length === 1 ? glyphNodes[0] : null;
        if (!node) return { xAdvance: 0, hasLayer: false };

        const location = editor.designLocationCell.value;
        const glyph = editor.glyphForId(node.glyphId);
        if (!glyph) return { xAdvance: 0, hasLayer: false };

        return {
          xAdvance: glyph.geometryAt(location).xAdvance,
          hasLayer: glyph.layerAt(location) !== null,
        };
      }),
    [editor],
  );

  return useSignalState(xAdvanceCell, { schedule: "frame" });
}
