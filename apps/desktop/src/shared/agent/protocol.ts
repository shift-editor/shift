import type {
  EditorView,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerView,
} from "@shift/runtime";
import type { GlyphId, SourceId } from "@shift/types";

/** Main-to-renderer calls for live agent inspection of one explicit window. */
export type AgentCallMap = {
  "editor.inspect": { request: void; response: EditorView };
  "font.get": { request: void; response: FontOverview };
  "glyphs.list": {
    request: { limit?: number; cursor?: string; sourceId?: SourceId };
    response: GlyphPage;
  };
  "glyphs.get": { request: GlyphSelector; response: GlyphSummary };
  "layers.get": {
    request: { glyphId: GlyphId; sourceId: SourceId };
    response: LayerView | null;
  };
};

export type AgentEventMap = Record<string, never>;
