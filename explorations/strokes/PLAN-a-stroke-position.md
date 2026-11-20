# Plan: `a-stroke-position`

**Spec:** [SPEC-a-stroke-position.md](./SPEC-a-stroke-position.md)  
**Spike:** [SPIKE-a-stroke-position.md](./SPIKE-a-stroke-position.md)  
**Branch:** `explore/strokes` (local only)  
**Status:** Q1–Q6 done 2026-11-20 (D-Q1 approved); nothing committed. Full gates green except the untracked `packages/wasm/src/generated-reference/` files, which fail `format:check` and `lint:check` (not part of this work).

## Overview

Move the spike's solver from a side module into the one path every stroke already takes, give the stored style a `position`, and let Offset Contour use the same offset on every contour. Rust first; the TypeScript side only follows the generated type, the fixtures and one availability rule.

## Architecture decisions

- **One entry point.** `exact_offset::outline` dispatches on `style.position`; callers do not change. No second function for callers to choose between.
- **Same value everywhere.** −1 … +1, left negative. No conversion at the bridge, in storage or in the UI.
- **No compatibility code.** The new field is required in the lib dict and in the DTO.
- **Offset reuses `offset_path`**, so open and closed contours take one rule.

## Dependency graph

```
Q1 style field + solver dispatch ─► Q2 validation, storage, cache key ─► Q4 CLI
                 │                                   │
                 └──────────────► Q3 offset_contour ─┤
                                                     ▼
                                      Q5 TS types, fixtures, availability, behaviour
                                                     ▼
                                      Q6 verify, docs, Checkpoint
```

## Tasks

- [x] **Q1. Style field and solver dispatch** (M)
  - Acceptance: `OutlineStrokeStyle` and `ExactStrokeStyle` carry `position`; `outline` runs the centred stroke at 0 and `aligned_outline` otherwise; every existing test builds its style with `position: 0.0` and stays green unchanged in meaning; the position tests run through the style field.
  - Verify: `cargo test -p shift-font --lib stroke`; `cargo clippy -p shift-font --all-targets`.
  - Files: `stroke/style.rs`, `exact_offset.rs`, `position.rs`, struct literals in `layer_edit.rs`, `live_stroke.rs`, `solve_cache.rs`, `shift-store/src/layer/format.rs`.
- [x] **Q2. Validation, storage and cache key** (S)
  - Acceptance: `require_position` refuses non-finite and out-of-range values in set, outline and intent paths with the spec's message; the lib dict round-trips `position` and a dict without it reads as none; the preview cache misses when only position changes; a skeleton's preview, bake and expand land on the stored side (bounds at −1 / 0 / +1; reversing swaps).
  - Verify: `cargo test -p shift-font`; the `every_style_field_keys_the_cache` row for `position` fails when the key omits it.
  - Files: `layer_edit.rs`, `live_stroke.rs`, `layer_lib.rs`, `solve_cache.rs`, `intents/layer_intents.rs`.
- [x] **Q3. Offset Contour on every contour** (S)
  - Acceptance: `offset_contour` uses `offset_path`, accepts open contours (one open contour out), follows the direction sign, keeps closed results closed; zero distance still refused; today's counter-clockwise square test keeps its meaning, and a clockwise square offsets the other way.
  - Verify: `cargo test -p shift-font --lib layer_edit`; `cargo test -p shift-font intents`.
  - Files: `layer_edit.rs` (doc comment and error text updated), `intents/layer_intents.rs` messages and tests.
- [x] **Q4. CLI** (S)
  - Acceptance: `shift stroke` commands take `--position` (default 0, same range check); help text names the convention; offset help names the direction sign.
  - Verify: `cargo test -p shift-cli`.
  - Files: `shift-cli/src/cli/stroke.rs`, `authoring/stroke.rs`.

#### Checkpoint A (agent)

- [x] `cargo fmt`, `cargo clippy --all-targets` (no new hits), `cargo test -p shift-font -p shift-cli -p shift-store`, mutation checks from the spec's Testing table.

- [x] **Q5. TypeScript follows the type** (M)
  - Acceptance: `pnpm generate:bridge-types` shows `position` on `OutlineStrokeStyle`; fixtures and `MENU_STROKE_STYLE` carry `position: 0`; the availability rule no longer refuses Offset on open contours (reasons and tests updated); a behaviour test sets a live stroke at −1 and +1 and sees the preview fill's bounds on that side; one undo step; an open contour offsets through the command.
  - Verify: `pnpm typecheck`; `pnpm test:desktop src/renderer/src/lib/commands src/renderer/src/behaviour/strokes`; `pnpm turbo run test --filter=@shift/editor`.
  - Files: `strokeMenuCommand.ts`, `strokeAvailability.ts`, `types/stroke.ts` (doc of the distance sign), the stroke tests, `strokePreview.test.ts`.
- [x] **Q6. Verify, docs, roadmap** (S)
  - Acceptance: `position.rs` header and `DOCS.md` for the stroke area state the convention and the single entry point; `ROADMAP.md` A3.1 and A1.2 updated; `SPEC-map.md` status; `pnpm lint:check`, `pnpm format:check`, `cargo fmt`, `python3 scripts/context-drift-check.py` clean for touched files.

## Results (2026-11-20)

- Rust: `cargo test -p shift-font -p shift-cli -p shift-store` green (shift-font 751). Mutation checks: dropping `position` from the cache key turns `every_style_field_keys_the_cache` red; routing `outline` around the dispatch turns three position tests red.
- Desktop: `pnpm test:desktop` 1674 tests green; `@shift/editor` 721 green; `pnpm typecheck` clean.
- Clippy: no new hits from this work. `pnpm lint:rust-ratchet` still reports the 15 hits that were there before.
- **Finding, not fixed:** Offset Contour keeps the inner-corner loops that `expand_path` always left (an inward offset of a square has overlap ears at its corners); the fill reads right, the contour geometry is not trimmed. `offset_path` does the same for open contours. Trimming needs curve-curve intersection, which kurbo lacks. Candidate follow-up: `a-stroke-offset-trim`.
- Offset sign flipped from "positive expands outward" to path direction (D-Q1); the menu's fixed +10 now offsets to the right of the direction of travel.

#### Checkpoint B (Tasos, optional before the panel)

- [ ] With `pnpm dev:watch`: set a stroke on a drawn line through the Glyph › Stroke menu (position 0 only until the panel ships); a position cannot be edited in the UI yet, so manual play waits for `a-stroke-panel`. The agent demonstrates position through `shift` CLI output instead.

## Risks

| Risk                                                                    | Mitigation                                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A literal for `OutlineStrokeStyle` elsewhere breaks the build late      | Q1 greps every literal first (listed in Files); the compiler finds the rest                          |
| Clockwise offset sign surprises someone                                 | D-Q1 is explicit; the panel shows inside / outside from winding                                      |
| Tight curvature loops in the one-sided stroke                           | Same limit as the centred stroke (spike finding 3); no regression, documented                        |
| Slower incremental Rust builds (`incremental = false`)                  | Accepted by Tasos; `pnpm dev:watch` rebuilds on save                                                 |

## Open questions

- None beyond D-Q1.
