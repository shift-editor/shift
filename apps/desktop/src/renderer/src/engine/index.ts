export { FontEngine } from "./FontEngine";

export { EditingManager } from "./editing";
export type { EditingEngineDeps } from "./editing";
export type { FontMetadata, FontMetrics } from "@shift/types";

export { FontEngineError, NoEditSessionError, NativeOperationError } from "./errors";

export { MockFontEngine } from "./mock";

export type { FontEngineAPI, NativeFontEngine } from "./native";
export { getNative, hasNative } from "./native";
