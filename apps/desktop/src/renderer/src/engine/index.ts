export { FontEngine, createFontEngine } from "./FontEngine";

export type { EngineCore } from "@/types/engine";

export { EditingManager } from "./editing";
export { SessionManager } from "./session";
export { InfoManager } from "./info";
export type { FontMetadata, FontMetrics } from "@shift/types";
export { IOManager } from "./io";

export { FontEngineError, NoEditSessionError, NativeOperationError } from "./errors";

export { MockFontEngine, createMockNative } from "./mock";

export type { FontEngineAPI, NativeFontEngine } from "./native";
export { getNative, hasNative } from "./native";
