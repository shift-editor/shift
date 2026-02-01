/**
 * Font Engine - Rust interface for font editing operations.
 *
 * @example
 * ```typescript
 * import { FontEngine } from '@/engine';
 *
 * const engine = new FontEngine();
 * engine.session.start(65); // Start editing 'A'
 * engine.editing.addPoint(100, 200, 'onCurve');
 * ```
 */

// Main class
export { FontEngine, createFontEngine } from "./FontEngine";

// Managers
export { EditingManager } from "./editing";
export { SessionManager } from "./session";
export { InfoManager, type FontMetadata, type FontMetrics } from "./info";
export { IOManager } from "./io";

// Errors
export { FontEngineError, NoEditSessionError, NativeOperationError } from "./errors";

// Mock for testing
export { MockFontEngine, createMockNative } from "./mock";

// Native types (for advanced use)
export type {
  FontEngineAPI,
  NativeFontEngine,
  NativeFontMetadata,
  NativeFontMetrics,
  NativeGlyphSnapshot,
  NativeContourSnapshot,
  NativePointSnapshot,
} from "./native";
export { getNative, hasNative } from "./native";
