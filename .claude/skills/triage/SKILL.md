---
name: triage
description: What to look for when triaging or reviewing a Shift pull request — which findings block it and which are notes for the reviewer — built from what Kostya's reviews keep asking for. Use whenever you triage a Shift PR before Kostya reviews it, review one yourself, or check your own branch before opening a PR. Links the `rust`, `typescript`, `signals` and `writing-tests` rules rather than restating them.
---

# /triage — What to flag in a Shift pull request

Kostya's review time is the expensive part. Each finding below came up in more than one review or
triage (#845, #853, #855, #856, #860–#864); catching it in triage saves a review round. Whatever
tool you triage in supplies the mechanics (how to mark files and lines); this skill is what to
mark.

## Before you start

- Read the PR body: its stack, "What moved to Rust vs stays in TS" and "Decisions to check".
- Load the rules for what the diff touches: `rust` for `.rs`, `typescript` for `.ts`/`.tsx`,
  `signals` for `signal`/`computed`/`effect`, `writing-tests` for tests.
- Run `pnpm scan:ts --since <base>` and `pnpm scan:rust --since <base>`. A hit the branch added is
  a note unless the body explains it.

## Blockers

A blocker means the PR should not merge as it stands. State it in one line with the file and lines.

1. **TypeScript decides a Rust rule.** Any TS path that answers what shift-font or its libraries
   answer: a "preview" or "fallback" layout, caret stops or screen order re-derived in TS, a
   second grapheme segmenter, "does this feature apply", a `WORKAROUND` comment. AGENTS.md
   ("Rust owns every answer"); `typescript` → "A fallback, preview or workaround is still a copy".
   Unless the body lists it as an accepted exception with a follow-up, it blocks.
2. **A side effect inside a `computed`**: a preload, load, signal write or engine mutation; or an
   effect (or React `useEffect`) that keeps a derived value in step. `signals` rule 6.
3. **A stored record gains a field without a default.** Older records crash the first reader
   (`run.features[tag]` on `undefined`). Ask whether the record is ever read back; if it is, it
   needs a schema default. `typescript` → "A new field on a stored record".
4. **Tests weakened or deleted without a replacement.** A test that drops half its invariant (pan
   restore no longer checked, a hit test replaced by "which glyph shows"), or a removed test not
   mapped to a surviving one. AGENTS.md "Testing"; `writing-tests`.
5. **Production code that exists only for `TestEditor`**: a default parameter, a special page or
   method no production caller uses. Tests drive the real paths.
6. **An error turned into an empty answer where the error is documented** (`unwrap_or_default()`
   on a read that returns `InvalidFont`). `rust` → "Never turn a failure into an empty answer".

## Notes

Mark the lines and say what to check. These are review comments he has made more than once.

- **Missing owner or query.** The same `find`/`findIndex` at several call sites; a free function
  whose first argument is its owner; domain rules (unique names, ordering) in a component.
  `typescript` → "Owners answer questions"; `rust` → "A method, not a free function".
- **State in the wrong place or in two places.** A module-level `WeakMap<Editor, …>`; one value
  with two owners (Scene and Pages both holding the shown page); fields not named `*Cell`; who
  resets something split across three sites. `typescript` → "State has one owner".
- **Change detection.** A new revision signal per concern, a flag that fires on any edit, a
  derived `PartialEq` or hand-rolled deep-equal deciding what changed. `signals` rule 2,
  `rust` → "Each part says what the same means", `typescript` → "Sameness belongs to the type".
- **Loose state and events.** `Option`s and `bool`s that are only valid in some combinations, flags
  toggled around a callback, several methods per event kind: an enum of phases or events.
  `rust` → "Phases are an enum, events are an enum".
- **Unreadable types and closures.** Three or more nested generics; a `filter_map` doing two `?`s
  into a tuple; nested ternaries in props. `rust` → "Name a type instead of nesting generics".
- **A type or component declared twice**: a wire enum in `shift-wasm` beside `shift-shape`'s, a
  test listing restating a node's fields, two inline-rename fields, `sameNodes` beside
  `samePages`.
- **Cost per frame or per edit.** A computed that rebuilds a whole tree because it also tracks
  every contour; a filter over all stops per line; a deep compare on every layout; work per drag
  frame with no measurement.
- **Hand-kept tables or helpers a library already has** (feature defaults beside HarfRust's, a
  pointer-drag hook beside drag libraries). Ask whether the library answers it.
- **Unexplained constants** (`0.2`, a 600-unit stand-in advance): where did the value come from?
- **Migration or compatibility code for data that never shipped.** Flag it for removal; don't ask
  him to read it.
- **`track(cell)` then `cell.peek()`** where the value is used: read `.value`. `signals` rule 3.
- **Tests**: a new test file for one small case beside an existing behaviour file; an oracle that
  checks only a direction (`x` decreases) rather than the landing point.

## Decisions to check

A choice the code makes that the body doesn't list (a live/export difference, a fallback, an
unmeasured cost, a default chosen for him) goes in a note marked **Decision**, and in the report.
Don't decide it for him; say what it trades.

## Writing the notes

- One sentence: what the lines do and what to check. Code names in backticks.
- Name the rule a finding breaks, so the fix is findable: "`signals` rule 6".
- Say nothing about how you judged it, and nothing about formatting, imports or generated files:
  the linters and generators cover those.
