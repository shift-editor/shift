# Validation

Point sequence and clipboard payload validation for the Shift font editor.

## Architecture Invariants

- **Architecture Invariant:** Every validator returns a `ValidationResult<T>` discriminated union -- callers branch on `valid` and access either `.value` (parsed payload) or `.errors` (structured `ValidationError[]`). Never throw from validators.
- **Architecture Invariant:** Point sequences must start and end with `onCurve` points. At most 2 consecutive `offCurve` points are allowed (cubic bezier). 3+ consecutive off-curve points are always invalid.
- **Architecture Invariant:** `Validate` methods come in pairs: a `ValidationResult`-returning variant for detailed errors (e.g. `canFormSegments`) and a boolean shortcut for hot paths (e.g. `canFormValidSegments`). The boolean variants must enforce identical rules without allocating error objects.
- **Architecture Invariant:** Clipboard validation checks serialized boundary payloads only. Editor/runtime glyph state validation belongs with the source-aware glyph model, not snapshot-era DTOs.

## Codemap

```
validation/src/
  types.ts              -- ValidationResult, ValidationError, ValidationErrorCode, PointLike
  Validate.ts           -- point sequence rules: ordering, segment formation, anchor checks
  ValidateClipboard.ts  -- clipboard payload shape checks (contours, points, metadata)
  index.ts              -- public barrel export
```

## Key Types

- `ValidationResult<T>` -- discriminated union: `{ valid: true; value: T }` or `{ valid: false; errors: ValidationError[] }`. Default `T` is `void` for check-only validators.
- `ValidationError` -- structured failure with machine-readable `code` (`ValidationErrorCode`), human-readable `message`, and optional `context` record.
- `ValidationErrorCode` -- union of all failure codes: `EMPTY_SEQUENCE`, `MUST_START_WITH_ON_CURVE`, `MUST_END_WITH_ON_CURVE`, `TOO_MANY_CONSECUTIVE_OFF_CURVE`, `ORPHAN_OFF_CURVE`, `INCOMPLETE_SEGMENT`, `INVALID_CLIPBOARD_CONTENT`.
- `PointLike` -- minimal `{ pointType: PointType }` interface accepted by all point-sequence validators. Full `Point` objects, snapshots, and test stubs all satisfy it.
- `Validate` -- namespace object with point predicates (`isOnCurve`, `isOffCurve`), pattern matchers (`matchesLinePattern`, `matchesQuadPattern`, `matchesCubicPattern`), sequence validators (`sequence`, `canFormSegments`), boolean shortcuts (`isValidSequence`, `canFormValidSegments`, `hasValidAnchor`), and result constructors (`ok`, `fail`, `error`).
- `ValidateClipboard` -- namespace object with `isClipboardContent` (validates contour array shape) and `isClipboardPayload` (validates full `shift/glyph-data` envelope with format, version, metadata, content).

## How it works

### Point sequence validation

`Validate` enforces the rules that make a sequence of `PointLike` objects drawable as bezier curve segments. A valid sequence starts and ends with `onCurve` points, with at most 2 consecutive `offCurve` points between anchors (forming line, quadratic, or cubic segments).

`Validate.sequence` checks structural validity (bookend on-curve, off-curve run length). `Validate.canFormSegments` additionally walks the sequence to verify every off-curve run is bounded by on-curve anchors -- i.e., the points can actually be decomposed into drawable segments.

Boolean shortcuts (`isValidSequence`, `canFormValidSegments`, `hasValidAnchor`) implement the same logic without allocating `ValidationError` objects, for use in render loops and per-frame checks.

### Clipboard validation

`ValidateClipboard.isClipboardContent` validates the contour/point structure of clipboard data. `isClipboardPayload` checks the full envelope (format string `"shift/glyph-data"`, version number, metadata with timestamp). Used by `Clipboard` when parsing pasted content.

## Workflow recipes

### Add a new validation error code

1. Add the code string to `ValidationErrorCode` in `types.ts`
2. Use it in a validator via `Validate.error("YOUR_CODE", "message")`
3. Add test cases covering the new failure path

## Gotchas

- `Validate.sequence` accepts a single `onCurve` point as valid, but `Validate.canFormSegments` requires at least 2 points. Use the right one depending on whether you need drawable segments or just a well-formed sequence.
- `ValidateClipboard.isClipboardPayload` hardcodes the format string `"shift/glyph-data"`. If the clipboard format changes, this must be updated in sync.
- The `PointLike` interface only requires `pointType` -- validators do not check coordinates or IDs. Use clipboard validators at serialization boundaries when full structural validation is needed.

## Verification

```bash
# Run all validation tests
cd packages/validation && npx vitest run

# Type check
cd packages/validation && npx tsc --noEmit
```

## Related

- `Clipboard` -- uses `Validate.hasValidAnchor` for copy eligibility and `ValidateClipboard.isClipboardContent` for paste parsing
- `Segments` / `Segment` -- uses `Validate.isOnCurve` / `Validate.isOffCurve` for segment decomposition
- `PointType` from `@shift/types` -- the underlying union (`"onCurve" | "offCurve"`) that `PointLike` wraps
