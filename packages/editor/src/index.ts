export { Editor } from "./lib/editor/Editor";
export { Font } from "./lib/model/Font";
export { FontStore } from "./lib/model/FontStore";
export { Glyph, GlyphLayer, GlyphRenderModel } from "./lib/model/Glyph";
export { ComponentGlyph } from "./lib/model/ComponentGlyph";
export { GlyphLayerEdit } from "./lib/model/GlyphLayerEdit";
export { GlyphLayerState } from "./lib/model/GlyphLayerState";
export { RenderGlyph } from "./lib/model/RenderGlyph";
export { Select } from "./lib/tools/select/Select";
export { ToolManager } from "./lib/tools/core/ToolManager";
export {
  batch,
  computed,
  effect,
  isTracking,
  keyedCache,
  KeyedCache,
  signal,
  signalDebug,
  traceReactiveRun,
  track,
  untracked,
  useSignalState,
} from "./lib/signals";
export type {
  ComputedSignal,
  Effect,
  KeyedCacheOptions,
  ReactiveRunTraceOptions,
  Signal,
  SignalDebugDumpOptions,
  SignalDebugSnapshot,
  WritableSignal,
} from "./lib/signals";
export type { FontOptions, FontStoreOptions, WorkspaceEditCoordinator } from "./types/font";
export type {
  DeleteMode,
  GlyphGeometrySelection,
  GlyphObjectIndex,
  GlyphObjectSegment,
  GlyphOptions,
  GlyphReader,
} from "./types/glyph";
export type { DesignAxisLocation, ExternalAxisLocation } from "./types/variation";
