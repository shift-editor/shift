# Validation

Point sequence validation and persistence schema checking for the Shift font editor.

## Architecture Invariants

- **Architecture Invariant:** Every validator returns a `ValidationResult<T>` discriminated union -- callers branch on `valid` and access either `.value` (parsed payload) or `.errors` (structured `ValidationError[]`). Never throw from validators.
- **Architecture Invariant:** Point sequences must start and end with `onCurve` points. At most 2 consecutive `offCurve` points are allowed (cubic bezier). 3+ consecutive off-curve points are always invalid.
- **Architecture Invariant:** `Validate` methods come in pairs: a `ValidationResult`-returning variant for detailed errors (e.g. `canFormSegments`) and a boolean shortcut for hot paths (e.g. `canFormValidSegments`). The boolean variants must enforce identical rules without allocating error objects.
- **Architecture Invariant:** `ValidateSnapshot` type guards narrow `unknown` to concrete snapshot types (`PointSnapshot`, `ContourSnapshot`, `GlyphSnapshot`). These are the sole defense before data crosses the NAPI boundary to Rust -- bypassing them can crash the native engine.
- **Architecture Invariant:** Persistence schemas use Zod and are the single source of truth for on-disk format shape. The inferred types (e.g. `PersistedRoot`) are derived from schemas, never hand-written separately.

## Codemap

```
validation/src/
  types.ts              -- ValidationResult, ValidationError, ValidationErrorCode, PointLike
  Validate.ts           -- point sequence rules: ordering, segment formation, anchor checks
  ValidateSnapshot.ts   -- runtime type guards for GlyphSnapshot, ContourSnapshot, etc.
  ValidateClipboard.ts  -- clipboard payload shape checks (contours, points, metadata)
  persistence.ts        -- Zod schemas for persisted document state, preferences, text runs
  index.ts              -- public barrel export
```

## Key Types

- `ValidationResult<T>` -- discriminated union: `{ valid: true; value: T }` or `{ valid: false; errors: ValidationError[] }`. Default `T` is `void` for check-only validators.
- `ValidationError` -- structured failure with machine-readable `code` (`ValidationErrorCode`), human-readable `message`, and optional `context` record.
- `ValidationErrorCode` -- union of all failure codes: `EMPTY_SEQUENCE`, `MUST_START_WITH_ON_CURVE`, `MUST_END_WITH_ON_CURVE`, `TOO_MANY_CONSECUTIVE_OFF_CURVE`, `ORPHAN_OFF_CURVE`, `INCOMPLETE_SEGMENT`, `INVALID_SNAPSHOT_STRUCTURE`, `INVALID_CONTOUR_STRUCTURE`, `INVALID_POINT_STRUCTURE`, `INVALID_POINT_TYPE`, `INVALID_CLIPBOARD_CONTENT`.
- `PointLike` -- minimal `{ pointType: PointType }` interface accepted by all point-sequence validators. Full `Point` objects, snapshots, and test stubs all satisfy it.
- `Validate` -- namespace object with point predicates (`isOnCurve`, `isOffCurve`), pattern matchers (`matchesLinePattern`, `matchesQuadPattern`, `matchesCubicPattern`), sequence validators (`sequence`, `canFormSegments`), boolean shortcuts (`isValidSequence`, `canFormValidSegments`, `hasValidAnchor`), and result constructors (`ok`, `fail`, `error`).
- `ValidateSnapshot` -- namespace object with type guards for `PointSnapshot`, `ContourSnapshot`, `AnchorSnapshot`, `RenderPointSnapshot`, `RenderContourSnapshot`, `GlyphSnapshot`. Also provides `glyphSnapshot` which returns `ValidationResult<GlyphSnapshot>` with detailed field-level errors.
- `ValidateClipboard` -- namespace object with `isClipboardContent` (validates contour array shape) and `isClipboardPayload` (validates full `shift/glyph-data` envelope with format, version, metadata, content).
- `PersistedRootSchema` -- top-level Zod schema for the entire persisted state file (registry, app modules, documents).
- `PersistedDocumentSchema` -- Zod schema for a single document's persisted state (docId, updatedAt, modules map).
- `SnapPreferencesSchema` / `UserPreferencesSchema` -- Zod schemas for user snap/preference settings.
- `TextRunModuleSchema` -- Zod schema for the text-run persistence module payload.

## How it works

### Point sequence validation

`Validate` enforces the rules that make a sequence of `PointLike` objects drawable as bezier curve segments. A valid sequence starts and ends with `onCurve` points, with at most 2 consecutive `offCurve` points between anchors (forming line, quadratic, or cubic segments).

`Validate.sequence` checks structural validity (bookend on-curve, off-curve run length). `Validate.canFormSegments` additionally walks the sequence to verify every off-curve run is bounded by on-curve anchors -- i.e., the points can actually be decomposed into drawable segments.

Boolean shortcuts (`isValidSequence`, `canFormValidSegments`, `hasValidAnchor`) implement the same logic without allocating `ValidationError` objects, for use in render loops and per-frame checks.

### Snapshot validation

`ValidateSnapshot` provides runtime type narrowing for glyph data coming from undo/redo snapshots, clipboard, or persistence. Each `is*` method performs exhaustive field-by-field checks (type, finiteness of numbers, nested arrays). `glyphSnapshot` returns a `ValidationResult<GlyphSnapshot>` with the first failing field identified in the error context.

`NativeBridge` calls `ValidateSnapshot.isGlyphSnapshot` before sending snapshots to Rust -- this is the last line of defense against malformed data crashing the native engine.

### Clipboard validation

`ValidateClipboard.isClipboardContent` validates the contour/point structure of clipboard data. `isClipboardPayload` checks the full envelope (format string `"shift/glyph-data"`, version number, metadata with timestamp). Used by `Clipboard` when parsing pasted content.

### Persistence schemas

Zod schemas in `persistence.ts` validate the shape of data read from disk. `PersistedRootSchema` is the top-level schema parsed in the persistence kernel on app startup. Types like `PersistedRoot` are inferred from the schemas via `z.infer`, keeping the schema and type in lockstep.

## Workflow recipes

### Add a new validation error code

1. Add the code string to `ValidationErrorCode` in `types.ts`
2. Use it in a validator via `Validate.error("YOUR_CODE", "message")`
3. Add test cases covering the new failure path

### Add a new snapshot type guard

1. Define the shape type in `@shift/types`
2. Add an `is*` method on `ValidateSnapshot` that checks each field
3. If detailed errors are needed, add a `ValidationResult`-returning variant following the pattern of `glyphSnapshot`

### Add a new persistence schema

1. Define the Zod schema in `persistence.ts`
2. Export the schema and inferred type from `index.ts`
3. Add a test case in `persistence.test.ts` with valid and invalid payloads

## Gotchas

- `ValidateSnapshot` type guards check `Number.isFinite` on coordinates -- `NaN` and `Infinity` both fail. This is intentional to prevent rendering artifacts and Rust panics.
- `Validate.sequence` accepts a single `onCurve` point as valid, but `Validate.canFormSegments` requires at least 2 points. Use the right one depending on whether you need drawable segments or just a well-formed sequence.
- `ValidateClipboard.isClipboardPayload` hardcodes the format string `"shift/glyph-data"`. If the clipboard format changes, this must be updated in sync.
- The `PointLike` interface only requires `pointType` -- validators do not check coordinates or IDs. Use `ValidateSnapshot.isPointSnapshot` when full structural validation is needed.

## Verification

```bash
# Run all validation tests
cd packages/validation && npx vitest run

# Type check
cd packages/validation && npx tsc --noEmit
```

## Related

- `Clipboard` -- uses `Validate.hasValidAnchor` for copy eligibility and `ValidateClipboard.isClipboardContent` for paste parsing
- `NativeBridge` -- calls `ValidateSnapshot.isGlyphSnapshot` before Rust snapshot restore
- `Segments` / `Segment` -- uses `Validate.isOnCurve` / `Validate.isOffCurve` for segment decomposition
- `SnapManager` -- uses `Validate.isOnCurve` / `Validate.isOffCurve` for snap target classification
- `Editor` -- parses `SnapPreferencesSchema` and `TextRunModuleSchema` from persisted state
- `persistence/kernel` -- parses `PersistedRootSchema` on app startup
- `PointType` from `@shift/types` -- the underlying union (`"onCurve" | "offCurve"`) that `PointLike` wraps
