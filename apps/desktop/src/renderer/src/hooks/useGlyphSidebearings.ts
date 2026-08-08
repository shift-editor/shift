import type { GlyphSidebearings } from "@shift/glyph-state";
import { useMemo } from "react";
import { computed, useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";

const EMPTY_SIDEBEARINGS: GlyphSidebearings = { lsb: null, rsb: null };

export interface GlyphSidebearingsState {
  readonly sidebearings: GlyphSidebearings;
  readonly hasLayer: boolean;
}

/** Returns live sidebearings and whether the displayed glyph has an authored layer. */
export function useGlyphSidebearings(): GlyphSidebearingsState {
  const editor = useEditor();
  const sidebearingsCell = useMemo(
    () =>
      computed(() => {
        const glyphNodes = editor.scene.cell.value.nodes.filter((node) => node.kind === "glyph");
        const node = glyphNodes.length === 1 ? glyphNodes[0] : null;
        if (!node) return { sidebearings: EMPTY_SIDEBEARINGS, hasLayer: false };

        const externalLocation = editor.externalLocationCell.value;
        const activeSourceId = editor.activeSourceIdCell.value;
        const glyph = editor.glyphForId(node.glyphId);
        if (!glyph) return { sidebearings: EMPTY_SIDEBEARINGS, hasLayer: false };

        return {
          sidebearings: glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell)
            .sidebearingsCell.value,
          hasLayer: activeSourceId
            ? glyph.layerForSource(activeSourceId) !== null
            : glyph.layerAt(externalLocation) !== null,
        };
      }),
    [editor],
  );

  return useSignalState(sidebearingsCell, { schedule: "frame" });
}
