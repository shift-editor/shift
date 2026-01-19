/**
 * Custom error class for FontEngine operations.
 */
export class FontEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontEngineError";
  }
}

/**
 * Error thrown when an operation requires an active edit session but none exists.
 */
export class NoEditSessionError extends FontEngineError {
  constructor() {
    super("No active edit session. Call session.start() first.");
    this.name = "NoEditSessionError";
  }
}

/**
 * Error thrown when an operation fails on the Rust side.
 */
export class NativeOperationError extends FontEngineError {
  constructor(operation: string, details?: string) {
    super(details ? `${operation} failed: ${details}` : `${operation} failed`);
    this.name = "NativeOperationError";
  }
}
