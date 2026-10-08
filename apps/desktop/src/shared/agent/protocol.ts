import type {
  AuthoredLayer,
  AxisCoordinate,
  EditorView,
  FontOverview,
  FontRevision,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  ResolvedGlyphs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftObservation,
} from "@shift/runtime";
import type { GlyphId, LayerId, SourceId } from "@shift/types";

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
  "font.revision": {
    request: { ifFontRevision?: FontRevision };
    response: FontRevision;
  };
  "editor.inspect": {
    request: { ifFontRevision?: FontRevision };
    response: ShiftObservation<EditorView>;
  };
  "font.get": {
    request: { ifFontRevision?: FontRevision };
    response: ShiftObservation<FontOverview>;
  };
  "locations.resolve": {
    request: { location: AxisCoordinate[]; ifFontRevision?: FontRevision };
    response: ShiftObservation<ResolvedLocation>;
  };
  "glyphs.list": {
    request: {
      limit?: number;
      cursor?: string;
      sourceId?: SourceId;
      ifFontRevision?: FontRevision;
    };
    response: ShiftObservation<GlyphPage>;
  };
  "glyphs.get": {
    request: { selector: GlyphSelector; ifFontRevision?: FontRevision };
    response: ShiftObservation<GlyphSummary>;
  };
  "glyphs.resolve": {
    request: {
      glyphIds: GlyphId[];
      location: AxisCoordinate[];
      ifFontRevision?: FontRevision;
    };
    response: ShiftObservation<ResolvedGlyphs>;
  };
  "layers.get": {
    request: { layerId: LayerId; ifFontRevision?: FontRevision };
    response: ShiftObservation<AuthoredLayer>;
  };
  "layers.resolve": {
    request: { layerId: LayerId; ifFontRevision?: FontRevision };
    response: ShiftObservation<ResolvedLayer>;
  };
  "layers.render": {
    request: {
      layerId: LayerId;
      overlays?: LayerOverlays;
      appearance?: LayerAppearance;
      ifFontRevision?: FontRevision;
    };
    response: ShiftObservation<LayerSvg>;
  };
};

export type AgentEventMap = Record<string, never>;
