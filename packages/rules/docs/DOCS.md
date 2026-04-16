# @shift/rules

Point editing rules engine that enforces geometric constraints (tangency, collinearity, handle co-movement) during drag operations by pattern-matching the point neighborhood around each selected point.

## Architecture Invariants

- **Architecture Invariant:** The rule table is a singleton built lazily by `getRuleTable`. All concrete patterns are expanded and collision-checked at build time; duplicate patterns throw unless the overriding spec sets `allowPatternOverride: true` with higher precedence.
- **Architecture Invariant:** The center point (offset 0) is always encoded by its type token (`C`, `S`, `H`), never as `@`. The `@` token only appears for *other* selected points in the window. This means `@` at offset 0 in a template is a semantic error.
- **Architecture Invariant:** `constrainDrag` operates on a **base glyph snapshot** (positions before the drag started). The drag delta (`mousePosition`) is applied internally. Callers must not pre-apply the delta to the glyph.
- **Architecture Invariant:** Rule moves override selected-point moves in the final `DragPatch`. If a rule computes a position for a point that is also selected, the rule position wins.
- **Architecture Invariant:** Precedence score is `patternLength * 1000 + priority`. Window size dominates by default (5-char patterns outscore 3-char patterns); `priority` breaks ties within the same length.
- **Architecture Invariant:** `prepareConstrainDrag` short-circuits rule resolution entirely when `selectionNeedsRuleResolution` returns false (all selected points are non-smooth corners with no adjacent handles or smooth points). In this case `allowsUniformTranslationCommit` is true and no rules are evaluated.

## Codemap

```
rules/src/
  types.ts        -- RuleId, MatchedRule, DragPatch, PointMove, diagnostics types
  parser.ts       -- expandPattern: template string -> concrete pattern strings
  rules.ts        -- RULE_SPECS definitions, buildRuleTable, getRuleTable singleton
  matcher.ts      -- pickRule, diagnoseSelectionPatterns: pattern building + table lookup
  actions.ts      -- constrainDrag, prepareConstrainDrag, applyRule: execute matched rules
  constraints.ts  -- maintainTangency, maintainCollinearity: vector math primitives
  index.ts        -- public re-exports
```

## Key Types

- `RuleId` -- union of seven rule identifiers (`moveRightHandle`, `moveLeftHandle`, `moveBothHandles`, `maintainTangencyRight`, `maintainTangencyLeft`, `maintainTangencyBoth`, `maintainCollinearity`)
- `RuleSpec` -- authoring-time rule definition: id, description, entries (pattern templates + affected refs), optional priority and override flag
- `RuleEntry` -- a single pattern template string plus its `AffectedPointSpec` array
- `AffectedPointSpec` -- `{ role, offset }` pairing a semantic role name with a contour-relative offset from the center point
- `RuleMatch` -- expanded entry stored in the rule table: resolved `Rule`, affected specs, precedence score, source template
- `MatchedRule` -- runtime match result: `pointId`, `ruleId`, `pattern`, and `affected` (role-keyed map of resolved `PointId` values)
- `DragPatch` -- output of `constrainDrag`: absolute `pointUpdates` and the list of `matched` rules
- `PreparedConstrainDrag` -- pre-computed state from `prepareConstrainDrag` (point index, matched rules, selected points) reusable across frames with different `mousePosition` values
- `SelectionRuleDiagnostics` -- per-point probe results for debugging pattern matches in dev tools

## How it works

### Pattern expansion (build time)

`RULE_SPECS` in `rules.ts` defines rules using template syntax with wildcards (`X` = any point) and set notation (`[CS]` = corner or smooth). `expandPattern` in `parser.ts` expands each template into all concrete pattern strings via cartesian product. `buildRuleTable` iterates every spec and entry, expanding templates and inserting each concrete pattern into a `Map<string, RuleMatch>`. Collisions are caught here.

### Pattern matching (drag start)

`prepareConstrainDrag` builds a `PointIndex` from the base glyph snapshot, then iterates each selected point. For each point, `pickRuleAtIndex` tries window sizes 5 and 3 (in that order). For each window size, `buildPattern` reads the point neighborhood from the contour using `Contours.at` for wrap-around on closed contours, maps each point to a token (`N`/`C`/`S`/`H`/`@`), and concatenates them into a concrete pattern string. The string is looked up in the rule table. The highest-precedence match wins. `computeAffectedPoints` resolves each `AffectedPointSpec` offset into a concrete `PointId`.

### Rule application (every frame)

`constrainPreparedDrag` first computes selected-point moves (base position + delta). Then for each `MatchedRule`, `applyRule` dispatches on `ruleId`:

- **moveRightHandle / moveLeftHandle / moveBothHandles** -- translate neighboring handles by the same delta as the selected anchor.
- **maintainTangencyRight / maintainTangencyLeft** -- call `maintainTangency` to mirror the opposite handle around the smooth point, preserving arm length.
- **maintainTangencyBoth** -- three sub-cases depending on which affected roles resolved: single target/reference pair, dual left/right handles through a smooth-smooth chain, or associated/other handle pair for adjacent smooth points.
- **maintainCollinearity** -- call `maintainCollinearity` to project the dragged handle onto the smooth-to-end axis.

Rule-computed moves are merged into the selected moves map (overriding where they overlap). The final `DragPatch` contains absolute positions for all affected points.

## Workflow recipes

### Add a new rule

1. Add a new member to the `RuleId` union in `types.ts` and its role mapping to `RuleAffectedRolesById`
2. Add a `defineRuleSpec(...)` entry to `RULE_SPECS` in `rules.ts` with the smallest window template that captures the behavior
3. Add a `case` branch in `applyRule` in `actions.ts` that consumes the resolved affected roles
4. If the rule needs new vector math, add a function in `constraints.ts`
5. Add tests in `rules.test.ts` covering pattern expansion, table lookup, and affected resolution

### Debug which rule matched a selection

Call `diagnoseSelectionPatterns` with the glyph and selected point IDs. It returns per-point `PointRuleDiagnostics` with all probes (window sizes tried, patterns generated, match status) and the winning `MatchedRule`. The desktop app exposes this via `dumpSelectionPatternsToConsole`.

### Override an existing pattern mapping

1. Set `allowPatternOverride: true` on the new `RuleSpec`
2. Give it a higher `priority` than the existing rule so its precedence score wins
3. Verify with tests that the override is accepted (no ambiguous-score throw)

## Gotchas

- `X` expands to four tokens (`N`, `C`, `S`, `H`), so a template like `X[CS]X` produces 32 concrete patterns. Combined with set notation this can create large cartesian products and unexpected collisions.
- Open contours emit `N` (no-point) at missing neighbor positions. Closed contours wrap around via `Contours.at`. A rule that works on closed contours may not match on open ones (or vice versa) due to `N` tokens.
- `maintainCollinearity` returns `null` when the smooth-to-end axis is degenerate or the projection collapses. The action silently skips the move in this case -- no error is thrown.
- `selectionNeedsRuleResolution` is a fast pre-check. If all selected points are non-smooth corners with no adjacent handles or smooth neighbors, no rules are evaluated at all. Adding a rule for plain corner neighborhoods will not fire unless this guard is updated.
- The `applyRule` switch is exhaustive by convention but not enforced by TypeScript (no `never` default). Adding a new `RuleId` without a matching case will silently produce no moves.

## Verification

```bash
# Unit tests (pattern expansion, table build, matching, affected resolution)
cd packages/rules && npx vitest run

# Type check
cd packages/rules && npx tsc --noEmit
```

## Related

- `NativeBridge.applySmartEdits` -- primary consumer; calls `constrainDrag` during drag operations
- `GlyphDraft` -- draft lifecycle that feeds `DragPatch.pointUpdates` into `Glyph.apply`
- `dumpSelectionPatternsToConsole` -- dev-tool that calls `diagnoseSelectionPatterns` for debugging
- `Contours.at` -- wrapping point accessor used by the matcher for closed/open contour handling
- `Glyphs.findPoint` -- locates a point's contour and index, used by `diagnoseSelectionPatterns`
- `Vec2` -- vector math from `@shift/geo` used by `constraints.ts` and `actions.ts`
