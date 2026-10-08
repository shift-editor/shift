import type {
  EditorInspection,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerAppearance,
  LayerOverlays,
  LayerSvg,
  LayerView,
  ShiftCapture,
  ShiftCaptureTarget,
  ShiftSession,
} from "@shift/runtime";
import type { GlyphId, SourceId } from "@shift/types";

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
    request: { windowId: number; target: ShiftCaptureTarget; scale?: number };
    response: ShiftCapture;
  };
  "shift.sessions.list": {
    request: undefined;
    response: ShiftSession[];
  };
  "shift.editor.inspect": {
    request: { windowId: number };
    response: EditorInspection;
  };
  "shift.font.get": { request: { windowId: number }; response: FontOverview };
  "shift.glyphs.list": {
    request: { windowId: number; limit?: number; cursor?: string; sourceId?: SourceId };
    response: GlyphPage;
  };
  "shift.glyphs.get": {
    request: { windowId: number } & GlyphSelector;
    response: GlyphSummary;
  };
  "shift.layers.get": {
    request: { windowId: number; glyphId: GlyphId; sourceId: SourceId };
    response: LayerView | null;
  };
  "shift.layers.render": {
    request: {
      windowId: number;
      glyphId: GlyphId;
      sourceId: SourceId;
      overlays?: LayerOverlays;
      appearance?: LayerAppearance;
    };
    response: LayerSvg | null;
  };
};

export type SandboxHostEventMap = Record<string, never>;
