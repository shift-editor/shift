import type {
  AuthoredLayer,
  AxisCoordinate,
  EditorView,
  FontOverview,
  FontRevision,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  KerningAtInput,
  KerningGroupSummary,
  KerningMasterValue,
  KerningPairPage,
  KerningPairQuery,
  LayerAppearance,
  LayerOverlays,
  LayerSelector,
  LayerSvg,
  ResolvedGlyphs,
  ResolvedKerningPairs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftObservation,
  ShiftReadInput,
  SourceSelector,
} from "@shift/runtime";
import type { GlyphId, KerningPosition } from "@shift/types";

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
      source?: SourceSelector;
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
  "kerning.groups": {
    request: { position?: KerningPosition; ifFontRevision?: FontRevision };
    response: ShiftObservation<KerningGroupSummary[]>;
  };
  "kerning.pairs": {
    request: {
      source?: SourceSelector;
      glyph?: GlyphSelector;
      limit?: number;
      cursor?: string;
      ifFontRevision?: FontRevision;
    };
    response: ShiftObservation<KerningPairPage>;
  };
  "kerning.resolve": {
    request: {
      pairs: KerningPairQuery[];
      source?: SourceSelector;
      // oxlint-disable-next-line shift/no-optional-collection-field -- absent means "use source or the default location"
      location?: AxisCoordinate[];
      ifFontRevision?: FontRevision;
    };
    response: ShiftObservation<ResolvedKerningPairs>;
  };
  "kerning.at": {
    request: ShiftReadInput<KerningAtInput> & { ifFontRevision?: FontRevision };
    response: ShiftObservation<KerningMasterValue>;
  };
  "layers.get": {
    request: LayerSelector & { ifFontRevision?: FontRevision };
    response: ShiftObservation<AuthoredLayer>;
  };
  "layers.resolve": {
    request: LayerSelector & { ifFontRevision?: FontRevision };
    response: ShiftObservation<ResolvedLayer>;
  };
  "layers.render": {
    request: LayerSelector & {
      overlays?: LayerOverlays;
      appearance?: LayerAppearance;
      ifFontRevision?: FontRevision;
    };
    response: ShiftObservation<LayerSvg>;
  };
  /**
   * Calls one agent reader's method with `args` once pending edits settle,
   * returning its plain result. Only the E2E read hook sends it.
   */
  "agent.read": {
    request: { reader: string; method: string; args: unknown[] };
    response: unknown;
  };
};

export type AgentEventMap = Record<string, never>;
