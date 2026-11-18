import { useMemo } from "react";
import { GlyphDesignspace } from "@/lib/variation/GlyphDesignspace";
import { useEditor } from "@/workspace/WorkspaceContext";

/** The edited glyph's own sources and axes, for the Designspace tab's glyph sections. */
export const useGlyphDesignspace = (): GlyphDesignspace => {
  const editor = useEditor();
  return useMemo(() => new GlyphDesignspace(editor), [editor]);
};
