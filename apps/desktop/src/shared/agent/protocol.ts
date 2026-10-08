import type {
  EditorView,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  LayerView,
} from "@shift/runtime";
import type { GlyphId, SourceId } from "@shift/types";

/** Main-to-renderer calls for live agent inspection of one explicit window. */
export interface EditorCaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AgentCallMap = {
  "capture.editorBounds": {
    request: undefined;
    response: EditorCaptureBounds;
  };
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
  "layers.render": {
    request: {
      glyphId: GlyphId;
      sourceId: SourceId;
      overlays?: LayerOverlays;
      appearance?: LayerAppearance;
    };
    response: LayerSvg | null;
  };
};

export type AgentEventMap = Record<string, never>;
