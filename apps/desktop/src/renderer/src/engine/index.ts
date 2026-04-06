export { FontEngine } from "./FontEngine";
export type { FontMetadata, FontMetrics } from "@shift/types";

export { FontEngineError, NoEditSessionError, NativeOperationError } from "./errors";

export type { FontEngineAPI } from "./native";

export { type GlyphDraft, produceGlyph } from "./draft";
