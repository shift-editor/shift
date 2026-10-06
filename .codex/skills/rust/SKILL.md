---
name: rust
description: Canonical rules for writing and reviewing Rust code in Shift's crates. Use whenever you add or change `.rs` code, especially error handling (`ok_or`, `ok_or_else`, `map_err`, `?`, `CoreError`, `StoreError`, `SlugError`, `BridgeError`), entity lookups by id, checked arithmetic and integer conversions, or helpers that several call sites repeat. Load `rustdoc` as well when the change adds or edits doc comments.
---

# /rust — How Rust is written in Shift

Shift's crates had the same failure built by hand at hundreds of sites: `.ok_or_else(|| CoreError::GlyphNotFound(glyph_id.clone()))?`, `.map_err(|_| SlugError::LengthOverflow)?`, `StoreError::MissingEntity { kind, id }` struct literals. Every copy drifted a little: different `kind` strings, eager `ok_or` cloning ids on the success path, lookups cloning an id just to pass it by value. The rules below keep a failure defined once and named at the call site.

## The rule

**A failure that recurs for the same reason is constructed in exactly one place.** Call sites say _what_ they need (`require_glyph`, `or_overflow`, `or_missing`), not _how_ to build the error.

`ok_or_else` with a site-specific error is fine. A message that only makes sense at one site, such as `InvalidLibValue("missing value")` in a parser, belongs inline. The second time the same error appears for the same reason, extract it.

## Error helpers that already exist

Use these before writing an error by hand:

| Failure                                        | Helper                                                                                                                           | Crate                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Entity missing from a `Font`                   | `font.require_glyph(&id)?`, `require_layer`, `require_layer_mut`, `require_layer_owner`, `require_source`, `require_axis`        | `shift-font` (`ir/font.rs`)                 |
| Entity missing from any other lookup           | `lookup.require(&id)?` (`Require` + `EntityRef`; the id's type picks the `*NotFound` variant)                                    | `shift-font` (`error.rs`)                   |
| Contour, point, or anchor missing from a layer | `layer.require_contour_mut(id)?`, `require_point_mut`, `require_point_contour`, `require_anchor_mut`                             | `shift-font` (`layer_edit.rs`)              |
| Length or offset overflow                      | `a.checked_add(b).or_overflow()?`, `u32::try_from(n).or_overflow()?`, `length::to_u32`, `length::ensure_total`, `length::within` | `shift-slug` (`length.rs`)                  |
| Row missing from the store                     | `lookup.or_missing("glyph", &id)?`, `order_index(conn, table, kind, &id)?`                                                       | `shift-store` (`error.rs`, `change_set.rs`) |
| Retained-source index out of range             | `identity.glyph_id(index)?`, `glyph_index`, `axis_id`, `source_id`                                                               | `shift-bridge` (`SourceIdentity`)           |

`?` converts between crate errors through the existing `From` impls (`SlugError` into `AuthoredSlugError`, `BridgeError` and the backends error; `CoreError` into `StoreError`). Do not name another crate's error variant at a call site, as in `shift_slug::SlugError::LengthOverflow`; call that crate's helper and let `?` convert.

## Adding a helper

When an error pattern repeats and no helper fits, add one next to the data it describes:

- **Lookups on an owner** (`Font`, `GlyphLayer`, `SourceIdentity`): add a `require_*` method beside the `Option` lookup. It takes the id by reference and returns `Result<&T, _>`.
- **One error for many value types** (all ids, all checked operations): add an extension trait on `Option<T>` or `Result<T, E>` whose method names the failure (`require`, `or_overflow`, `or_missing`), plus one impl per input type. A macro like `entity_ref!` keeps one line per variant.
- **A repeated query or computation that ends in the error** (the same SQL with `.optional()?`): extract the whole operation as one function, not just its error.
- **Only one crate needs it**: keep it `pub(crate)`. Export it only when another crate would otherwise build the same error.

Every new helper gets Rustdoc with an `# Errors` section (see `rustdoc`) and a unit test of the failure it produces.

## Lookups and ids

- Lookups take ids by reference: `fn glyph(&self, id: &GlyphId)`. Ids are `String` newtypes; a by-value parameter forces every caller that keeps its id to clone it. Take an id by value only when the function stores or returns it.
- Never pass `&id.clone()`; borrow the id you have.
- Never clone an id only to build an error that is probably not returned. Use `ok_or_else` or the helpers above, which format the id only on failure. `ok_or(CoreError::X(id.clone()))` clones on every call, including successful ones.
- `Option` lookups (`font.glyph(id)`) are for "absent is a normal answer". Use `require_*` when absence is an error for this caller.

## Arithmetic and conversions

- Lengths, offsets, and counts that reach packed buffers use checked arithmetic with `.or_overflow()?`. Keep the `checked_add`/`checked_mul` visible at the call site.
- Integer narrowing uses `try_from` with `.or_overflow()?` or `length::to_u32`. Never use `as` for a narrowing conversion that can lose data.
- Bit-packed fields with a limit below their integer type go through `length::within(value, MASK)?`.

## Review checklist

- [ ] No `CoreError::*NotFound`, `SlugError::LengthOverflow`, or `StoreError::MissingEntity` built inline where a helper above applies.
- [ ] No other crate's error variant named at a call site.
- [ ] No id cloned on a lookup's success path just for its error.
- [ ] Any error built at two or more sites for the same reason has one helper, with Rustdoc and a test.
- [ ] `cargo fmt`, `cargo clippy` for the affected crates, and their tests pass.
