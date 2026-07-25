import type { GlyphSidebearings } from "@/lib/model/Glyph";
import { computed, useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { useMemo } from "react";

const EMPTY_SIDEBEARINGS: GlyphSidebearings = { lsb: null, rsb: null };

export interface GlyphSidebearingsState {
  readonly sidebearings: GlyphSidebearings;
  readonly hasLayer: boolean;
}

/**
 * Current glyph sidebearings (LSB/RSB), live-updating.
 *
 * Subscribes to the displayed glyph instance. Interpolated instances still
 * expose resolved values, but report `editable: false` so inputs can display
 * them without mutating a missing authored glyph layer.
 *
 * @returns Current values and whether the displayed instance can be edited.
 */
export function useGlyphSidebearings(): GlyphSidebearingsState {
  const editor = useEditor();
  const sidebearingsCell = useMemo(
    () =>
      computed(() => {
        const glyphNodes = editor.scene.cell.value.nodes.filter((node) => node.kind === "glyph");
        const node = glyphNodes.length === 1 ? glyphNodes[0] : null;
        if (!node) return { sidebearings: EMPTY_SIDEBEARINGS, hasLayer: false };

        const location = editor.designLocationCell.value;
        const glyph = editor.glyphForId(node.glyphId);
        if (!glyph) return { sidebearings: EMPTY_SIDEBEARINGS, hasLayer: false };

        const renderModel = glyph.renderModelAt(editor.designLocationCell);

        return {
          sidebearings: renderModel.sidebearingsCell.value,
          hasLayer: glyph.layerAt(location) !== null,
        };
      }),
    [editor],
  );

  return useSignalState(sidebearingsCell, { schedule: "frame" });
}
