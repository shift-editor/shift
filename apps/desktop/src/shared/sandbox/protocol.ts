import type {
  EditorInspection,
  FontOverview,
  GlyphPage,
  GlyphSelector,
  GlyphSummary,
  LayerView,
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
};

export type SandboxHostEventMap = Record<string, never>;
