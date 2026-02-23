# @shift/rules

Pattern-based point editing rules for geometric constraints.

## Terminology

- `selectedIds`: points currently selected in the editor.
- `matched point`: the selected point currently being checked by `pickRule(...)`.
- `center point`: same as matched point; pattern offset `0`.
- `affected`: semantic role map on `MatchedRule` (e.g. `{ smooth, oppositeHandle }`).
- `affected rule refs`: rule spec entries defined as `{ role, offset }`.

## Pattern syntax

Rules are defined by **pattern templates** in `rules.ts`. Templates are expanded into **concrete patterns** (see `parser.ts`); the matcher builds a concrete pattern from the contour and does an exact lookup (see `matcher.ts`).

### Tokens

| Token | Meaning                                           | Where used            |
| ----- | ------------------------------------------------- | --------------------- |
| `N`   | No point (contour end / gap)                      | Concrete pattern only |
| `C`   | Corner (on-curve, not smooth)                     | Template and concrete |
| `S`   | Smooth (on-curve, smooth)                         | Template and concrete |
| `H`   | Handle (off-curve)                                | Template and concrete |
| `@`   | Selected point (the center point being evaluated) | Template and concrete |
| `X`   | Any point (expands to N, C, S, H)                 | Template only         |

Concrete patterns are built only from `N`, `C`, `S`, `H`, `@`.

### Set notation

- **Syntax:** `[` followed by one or more tokens, then `]`.
- **Meaning:** One character from this set at this position.
- **Expansion:** Each position is one dimension in a cartesian product. The template is expanded into all combinations.

Examples:

- `[CS]` → `C` or `S`.
- `[X@]` → any point or selected: N, C, S, H, or `@`.
- `[CS]H` → `CH`, `SH`.
- `H[CS]H` → `HCH`, `HSH`.

### How matching works

1. For a selected point, the matcher takes a **window** of points around it (window sizes 5 and 3 are tried).
2. Each point in the window is mapped to a single token (N/C/S/H by type, or `@` if it is selected and not the center).
3. The **center** of the window is the point being evaluated (offset 0).
4. That yields a concrete pattern string (e.g. `HCH`, `@SH`).
5. The rule table is a map from **concrete pattern** → rule; lookup is exact.

## What "matched point" means

`constrainDrag(...)` iterates every selected point and runs `pickRule(...)` for each one.
So with single selection, it is usually the point you clicked/dragged. With multi-selection, each selected point can become the matched point for its own rule match.

## How affected rule refs work

Offsets are relative to the matched/center point:

- `-1`: previous point in contour order
- `0`: the matched point itself
- `+1`: next point in contour order

Resolution uses `Contours.at(contour, centerIndex + offset, contour.closed)`.
For closed contours this wraps around; for open contours missing neighbors are skipped.

Each rule entry encodes semantic references as `{ role, offset }`, where:

- `role` is rule-specific (typed by `ruleId`)
- `offset` is relative to the matched point (`-1`, `+1`, etc.)

Matcher output resolves these refs into `matchedRule.affected`, a role-keyed map.
Action code consumes roles directly (not positional arrays).

## Precedence policy

When multiple window sizes produce matches for the same selected point:

- Longer concrete patterns win by default (5-point over 3-point).
- Rules can raise precedence explicitly via `priority`.
- Final score is `patternLength * 1000 + priority`.

This keeps behavior stable while allowing rare explicit overrides.

## Collision policy

The rule table fails fast on duplicate concrete patterns.

- By default, duplicate concrete patterns throw during table build.
- To intentionally replace a concrete pattern mapping, set `allowPatternOverride: true`
  on the overriding rule and give it higher precedence.

## Rule authoring checklist

Use this flow when adding or editing entries in `src/rules.ts`.

1. Pick the smallest window that still encodes the behavior.
2. Write one or more `patternTemplate` entries that capture the intended point neighborhood.
3. Define `affected` refs as `{ role, offset }` with meaningful role names.
4. Expand mentally (or with tests) to concrete patterns and check for collisions.
5. Only use `allowPatternOverride: true` when replacing an existing concrete mapping intentionally.
6. Set `priority` only to break ties or intentionally outrank another matching rule.
7. Add tests for matching and resolved `matchedRule.affected` roles.

## Authoring pitfalls

- `@` never appears at offset `0` in runtime patterns; center point is encoded by type (`C`, `S`, `H`).
- `X` expands to `N`, `C`, `S`, `H` and can introduce many concrete collisions.
- Open contours can emit `N` at missing neighbors; closed contours wrap instead.
- Assigning the wrong role for a rule entry can break action mapping even when pattern matching still passes.

## Override and precedence example

If two specs generate the same concrete pattern:

- default behavior: table build throws.
- intentional override: set `allowPatternOverride: true` on the overriding spec and give it a higher score.
- score formula: `concretePatternLength * 1000 + priority`.

Example:

- base: `patternTemplate: "NCH"`, `priority: 0` => score `3000`.
- override: same concrete pattern with `priority: 1` => score `3001` and wins.
- same score for different rule ids => table build throws as ambiguous.

## Test expectations for rule changes

When editing `RULE_SPECS`, update or add tests in `src/rules.test.ts` for:

- concrete pattern table mapping (`buildRuleTable` / `buildRuleTableFromSpecs`)
- duplicate and override behavior (throw vs accepted override)
- matcher behavior for both window sizes where relevant
- resolved `matchedRule.affected` role map used by action code
