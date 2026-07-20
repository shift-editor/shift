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
        const view = editor.font.glyphView(node.glyphId, editor.designLocationCell);
        if (!view) return { xAdvance: 0, hasLayer: false };

        return {
          xAdvance: view.xAdvanceCell.value,
          hasLayer: editor.font.editableLayerAt(node.glyphId, location) !== null,
        };
      }),
    [editor],
  );

  return useSignalState(xAdvanceCell, { schedule: "frame" });
}
