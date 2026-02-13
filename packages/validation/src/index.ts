/**
 * @shift/validation - Point Sequence Validation
 *
 * A functional library for validating point sequences in font editing.
 * Ensures sequences can form valid curve segments before operations like copy/paste.
 *
 * @example
 * ```ts
 * import { Validate } from '@shift/validation';
 *
 * // Quick boolean check (most performant)
 * if (Validate.canFormValidSegments(points)) {
 *   // Safe to copy
 * }
 *
 * // Detailed validation with error info
 * const result = Validate.canFormSegments(points);
 * if (!result.valid) {
 *   console.error(result.errors[0].message);
 * }
 * ```
 */

export { Validate } from "./Validate";
export { ValidateSnapshot } from "./ValidateSnapshot";
export { ValidateClipboard } from "./ValidateClipboard";
export {
  PersistedTextRunSchema,
  TextRunModulePayloadSchema,
  SnapPreferencesSchema,
  UserPreferencesSchema,
  PersistedModuleEnvelopeSchema,
  PersistenceRegistrySchema,
  PersistedDocumentStateSchema,
  PersistedRootSchema,
} from "./persistence";

export type { ValidationResult, ValidationError, ValidationErrorCode, PointLike } from "./types";
export type {
  PersistedTextRun,
  TextRunModulePayload,
  SnapPreferencesShape,
  UserPreferences,
  PersistedModuleEnvelope,
  PersistenceRegistry,
  PersistedDocumentState,
  PersistedRoot,
} from "./persistence";
