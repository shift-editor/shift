export { FontEngine } from "./FontEngine";

export { EditingManager } from "./editing";
export type { EditingEngineDeps } from "./editing";
export { SessionManager } from "./session";
export type { Session as SessionEngineDeps } from "./session";
export { InfoManager } from "./info";
export type { Info as InfoEngineDeps } from "./info";
export type { FontMetadata, FontMetrics } from "@shift/types";
export { IOManager } from "./io";
export type { IO as IOEngineDeps } from "./io";

export { FontEngineError, NoEditSessionError, NativeOperationError } from "./errors";

export { MockFontEngine } from "./mock";

export type { FontEngineAPI, NativeFontEngine } from "./native";
export { getNative, hasNative } from "./native";
