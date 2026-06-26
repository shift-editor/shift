import { useEditor } from "@/workspace/WorkspaceContext";
import { useSignalState, useSignalTrigger } from "@/lib/signals";

export interface GlyphXAdvanceState {
  readonly xAdvance: number;
  readonly hasLayer: boolean;
}

/**
 * Current glyph xAdvance, live-updating. Returns `0` when no glyph is loaded.
 */
export function useGlyphXAdvance(): GlyphXAdvanceState {
  const editor = useEditor();
  const instance = useSignalState(editor.glyphInstanceCell);

  useSignalTrigger(instance?.xAdvanceCell, { schedule: "frame" });

  return {
    xAdvance: instance?.xAdvance ?? 0,
    hasLayer: instance?.hasLayer ?? false,
  };
}
