export { FontEngine } from "./FontEngine";
export type { FontMetadata, FontMetrics } from "@shift/types";

export { FontEngineError, NoEditSessionError, NativeOperationError } from "./errors";

export type { FontEngineAPI, NativeFontEngine } from "./native";
export { getNative, hasNative } from "./native";

export { type GlyphDraft, produceGlyph } from "./draft";
