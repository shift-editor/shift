# Validation

<!-- reviewed: 2026-09-05 review-every: 90d -->

Point-type predicates and clipboard payload validation for the Shift font editor.

## Architecture Invariants

- **Architecture Invariant:** Validators never throw; every one returns a plain `boolean`.
- **Architecture Invariant:** Whether points form drawable segments is shift-font's rule (`SegmentIndexIter`, `PointKinds`). This package keeps only point-type predicates, with no TypeScript copy of segment formation.
- **Architecture Invariant:** Clipboard validation checks serialized boundary payloads only. Editor/runtime glyph state validation belongs with the source-aware glyph model, not snapshot-era DTOs.

## Codemap

```
validation/src/
  types.ts              -- PointLike
  Validate.ts           -- point-type predicates: isOnCurve, isOffCurve, hasValidAnchor
  ValidateClipboard.ts  -- clipboard payload shape checks (contours, points, metadata)
  index.ts              -- public barrel export
```

## Key Types

- `PointLike` -- minimal `{ pointType: PointType }` interface the predicates accept. Full `Point` objects, snapshots, and test stubs all satisfy it.
- `Validate` -- `isOnCurve` (`onCurve` or `qCurve`), `isOffCurve`, and `hasValidAnchor` (some point is on-curve).
- `ValidateClipboard` -- namespace object with `isShiftContent` (validates portable contour content; the one validator the app calls) and `isClipboardPayload` (validates the full `shift/glyph-data` envelope with format, version, metadata, content; currently has no callers outside this package).

## How it works

### Clipboard validation

`ValidateClipboard.isShiftContent` validates the contour/point structure of portable Shift content; `Clipboard` calls it when parsing pasted content. `isClipboardPayload` checks the full envelope (format string `"shift/glyph-data"`, version number, metadata with timestamp) but currently has no callers outside this package -- `Clipboard.tryDeserialize` checks format and version inline with laxer semantics and calls only `isShiftContent`.

## Gotchas

- `ValidateClipboard.isClipboardPayload` hardcodes the format string `"shift/glyph-data"`. If the clipboard format changes, this must be updated in sync.
- The `PointLike` interface only requires `pointType` -- the predicates do not check coordinates or IDs. Use clipboard validators at serialization boundaries when full structural validation is needed.

## Verification

```bash
# Run validation tests through the root Turbo graph
pnpm test --filter=@shift/validation

# Type check
pnpm --filter @shift/validation typecheck
```

## Related

- `ClipboardSelection` -- uses `Validate.hasValidAnchor` for copy eligibility and `Validate.isOnCurve`/`isOffCurve` for selection expansion
- `Clipboard` -- uses `ValidateClipboard.isShiftContent` for paste parsing (imports nothing else from this package)
- `Segment` (in `@shift/glyph-state`) -- segment decomposition uses glyph-state's own `Point.isOnCurve`/`Point.isOffCurve`, not this package; other `Validate` predicate callers are `ToggleSmooth`, `FontStore`, and `ControlLines`
- `PointType` from `@shift/types` -- the underlying union (`"onCurve" | "offCurve" | "qCurve"`) that `PointLike` wraps
