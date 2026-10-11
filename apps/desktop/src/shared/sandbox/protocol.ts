import type {
  AuthoredLayer,
  EditorInspection,
  FontOverview,
  GlyphGetInput,
  GlyphListInput,
  GlyphPage,
  GlyphResolveInput,
  GlyphSummary,
  KerningGroupsInput,
  KerningGroupSummary,
  KerningPairPage,
  KerningPairsInput,
  KerningResolveInput,
  LayerGetInput,
  LayerRenderInput,
  LayerResolveInput,
  LayerSvg,
  LocationResolveInput,
  ResolvedGlyphs,
  ResolvedKerningPairs,
  ResolvedLayer,
  ResolvedLocation,
  ShiftCapture,
  ShiftCaptureInput,
  ShiftObservation,
  ShiftSession,
  ShiftTarget,
} from "@shift/runtime";

export type SandboxCallMap = {
  "sandbox.execute": {
    request: { code: string };
    response: unknown;
  };
};

export type SandboxEventMap = {
  "sandbox.ready": null;
};

export type SandboxHostCallMap = {
  "shift.capture": {
    request: ShiftCaptureInput;
    response: ShiftObservation<ShiftCapture>;
  };
  "shift.sessions.list": {
    request: undefined;
    response: ShiftSession[];
  };
  "shift.editor.inspect": {
    request: ShiftTarget;
    response: ShiftObservation<EditorInspection>;
  };
  "shift.font.get": {
    request: ShiftTarget;
    response: ShiftObservation<FontOverview>;
  };
  "shift.locations.resolve": {
    request: LocationResolveInput;
    response: ShiftObservation<ResolvedLocation>;
  };
  "shift.glyphs.list": {
    request: GlyphListInput;
    response: ShiftObservation<GlyphPage>;
  };
  "shift.glyphs.get": {
    request: GlyphGetInput;
    response: ShiftObservation<GlyphSummary>;
  };
  "shift.glyphs.resolve": {
    request: GlyphResolveInput;
    response: ShiftObservation<ResolvedGlyphs>;
  };
  "shift.kerning.groups": {
    request: KerningGroupsInput;
    response: ShiftObservation<KerningGroupSummary[]>;
  };
  "shift.kerning.pairs": {
    request: KerningPairsInput;
    response: ShiftObservation<KerningPairPage>;
  };
  "shift.kerning.resolve": {
    request: KerningResolveInput;
    response: ShiftObservation<ResolvedKerningPairs>;
  };
  "shift.layers.get": {
    request: LayerGetInput;
    response: ShiftObservation<AuthoredLayer>;
  };
  "shift.layers.resolve": {
    request: LayerResolveInput;
    response: ShiftObservation<ResolvedLayer>;
  };
  "shift.layers.render": {
    request: LayerRenderInput;
    response: ShiftObservation<LayerSvg>;
  };
};

export type SandboxHostEventMap = Record<string, never>;
