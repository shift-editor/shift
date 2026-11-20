# Spec: `a-stroke-position`

**Branch:** `explore/strokes`  
**Module:** [SPEC-map.md](./SPEC-map.md) → `a-stroke-position`  
**Spike:** [SPIKE-a-stroke-position.md](./SPIKE-a-stroke-position.md) (rule proven, D-P1–D-P3 decided)  
**ROADMAP:** A3.1 (stroke options), A1.2 (offset)  
**Last revised:** 2026-11-20  
**Status:** D-Q1 approved; implemented 2026-11-20 (see the plan's Results)

## Objective

A dynamic stroke carries a **position**: where the stroke lies relative to its skeleton, from entirely on the left of the path direction (−100 %) through centred (0 %) to entirely on the right (+100 %). It works on open and closed skeletons. **Offset Contour** works on open and closed contours with the same side rule.

**Success looks like:** a straight two-point contour with a width-20 stroke at −100 % draws its fill entirely above the line (left of a left-to-right path); at 0 % it is unchanged from today; at +100 % it is entirely below. The preview, Expand and the CLI agree. Offset Contour on an open contour returns one open contour at the distance, on the side the sign says.

## Verified starting point

Checked against the code on 2026-11-20.

| Fact                                                                                                                                                               | Where                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `position::aligned_outline` and `offset_path` exist and are tested (16 tests), wired to nothing                                                                    | `crates/shift-font/src/stroke/position.rs`                               |
| Every solve goes through `exact_offset::outline(skeleton, &ExactStrokeStyle, tol)`: preview (cached), the layer's outline paths, `bake_stroke_outlines`, `outline_stroke_contours` | `live_stroke.rs`, `layer_edit.rs`                                        |
| `OutlineStrokeStyle` (`width`, `cap`, `join`, `miter_limit`) derives `Pack`, so the bridge DTO and `@shift/types` are generated from it                           | `stroke/style.rs`, `packages/types/src/bridge/`                          |
| The style is stored as a dict in the layer lib under `com.shift.stroke`; a missing or invalid field makes the style unreadable                                     | `stroke/layer_lib.rs` `outline_style_from_lib`                           |
| The preview cache key hashes every style field (`to_bits`); a test checks each field changes the key                                                               | `stroke/solve_cache.rs`, `live_stroke.rs` `every_style_field_keys_the_cache` |
| `offset_contour` uses kurbo `expand_path` and refuses open contours; positive distance expands outward                                                            | `stroke/layer_edit.rs`                                                   |
| The editor's availability rule refuses Offset on open contours                                                                                                     | `strokeAvailability.ts`                                                  |
| Nothing else consumes strokes yet (no released documents), so no migration is needed                                                                               | Tasos, 2026-11-20                                                        |

## Design

### One value, one convention

`position: f64` in `[-1, 1]`. `-1` is entirely left of the direction of travel, `+1` entirely right, `0` centred. Stored, passed through the bridge and shown as −100 % … +100 % without any conversion. y-up coordinates, as everywhere.

A counter-clockwise closed contour has its inside on the left, so −100 % is inside and +100 % outside there; a clockwise contour reads the other way. Reversing a path swaps the side.

### Solver

- `ExactStrokeStyle` gains `position`. `exact_offset::outline` becomes the single entry: `position == 0` runs kurbo's centred stroke (renamed `centred_outline`, unchanged behaviour), otherwise `position::aligned_outline`. All four call sites get position with no change of their own.
- `position.rs` graduates from spike: its header drops "(spike)", `aligned_outline` reads `style.position` instead of taking a separate argument; the 16 tests keep their cases by setting the style field.
- The construction is the spike's: two offsets of the skeleton at `−position·w/2 ± w/2`, joined by the caps. Quality and cost are in the spike (cheaper than the centred stroke; ≤ 0.013 % cell disagreement with shift-then-stroke; no jump near 0).

### Style, validation, storage

- `OutlineStrokeStyle.position`, finite and within `[-1, 1]`, checked by one `require_position` next to `require_positive_width`, used wherever width is: `set_live_stroke_contours`, `outline_stroke_contours`, and the intent validation. Failure text: "stroke position must be between -1 and 1".
- `com.shift.stroke` stores `position` as a float next to `miterLimit`. It is required: no backward compatibility (nothing is released), so a dict without it is unreadable like any other missing field.
- The cache key hashes `position.to_bits()`; the per-field key test gains a row.
- `OutlineStrokeStyle::round(width)` and the CLI default `position` to `0`.

### Offset Contour on every path

`offset_contour` uses `position::offset_path` for open and closed contours and drops the closed-only refusal. The sign of `distance` follows the position convention: **negative offsets to the left of the direction of travel, positive to the right.** An open contour stays open (one open contour out); a closed one stays closed. Joins and miter limit apply to the outer side of corners as before.

This **changes today's meaning for clockwise closed contours** (D-Q1).

### Not in this module

- The Position row, the direction cue and the Offset dialog fields: `a-stroke-panel`.
- Trimming the inner-corner loops of an offset (as `expand_path` left them; needs curve-curve intersection), per-end caps, tight-curvature loops (the stroker's limit; the centred stroke has it too), overlap removal (`a-stroke-export`), interpolation of `position` between sources (`a-stroke-interp-spike`).

## Decisions

| #    | Decision                                                                                                              | Recommendation                                                                                                                 | Why                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-Q1 | Offset sign: by **path direction** for every contour, or direction for open ones and outward / inward for closed ones? | **Direction for every contour.** Positive offsets right: outward for a counter-clockwise contour, inward for a clockwise one. | One rule matches stroke position and Glyphs' Offset Curve. Two rules would make the same number mean different things on a contour depending on whether it is closed. The panel can show the closed-contour reading ("outside" / "inside") from the winding. The cost: a clockwise outline offset by +10 shrinks |

## Testing

| Layer                  | What                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust, solver           | The existing position tests, through the style field; `outline` with `position: 0` equals today's output byte for byte (the existing exact-offset and fixture-oracle tests stay green untouched)                                                                           |
| Rust, flow             | A live stroke's preview, bake and `outline_stroke_contours` all move to the stored side: bounds of a two-point skeleton at −1 / 0 / +1; position changes the preview cache key; reversing the skeleton swaps the side                                                         |
| Rust, storage          | Style with `position` round-trips through the lib; a dict missing `position` reads as no style; a non-finite or out-of-range position is refused with the reason, in set, outline and intent                                                                                |
| Rust, offset           | Open contour: one open contour, at the distance, left for negative and right for positive; closed contour: today's square grows for the counter-clockwise case; a clockwise contour offsets the other way; a zero distance is still refused                                |
| CLI                    | `--position` reaches the stored style; default 0                                                                                                                                                                                                                           |
| Desktop (`TestEditor`) | `setLiveStroke` with a position shows the preview fill's bounds on that side; `applyDynamicStroke` with position is one undo step; the offset command accepts an open contour and the availability rule no longer refuses it                                               |
| Mutation check         | Drop `position` from the cache key, and drop the dispatch in `outline`: each must turn a test red                                                                                                                                                                          |

## Boundaries

- **Always:** `nix develop --command`; `cargo fmt`, `cargo clippy --all-targets`; `pnpm generate:bridge-types` and `pnpm generate:from-rust` after the Rust change; `libm` for trigonometry in Rust (clippy enforces it); fixtures and tests carry `position: 0` explicitly where they build a style.
- **Ask first:** changing the on-disk shape beyond `position`, any new `CommandId`.
- **Never:** convert the sign between layers; add a TypeScript copy of the position rule; stage `crates/shift-bridge/index.js`, `explorations/ui-sound/`, `packages/wasm/src/generated-reference/`.
