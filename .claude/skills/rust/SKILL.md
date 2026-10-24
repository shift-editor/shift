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
| Contour, point, or anchor missing from a layer | `layer.require_contour_mut(id)?`, `require_point_mut`, `require_point_contour`                                                   | `shift-font` (`layer_edit.rs`)              |
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

## Error types

A failure that callers may handle, test, or wrap is a type, not text.

- A function that can fail for more than one reason returns a `thiserror` enum with one variant per reason. Never return `Result<_, String>` or add a `{ message: String }` variant to carry another error.
- Wrap another module's error with `#[from]` or `#[source]`; never `.map_err(|error| error.to_string())`. Include `{0}` or `{source}` in the wrapping message when callers surface errors through `to_string()`, so the detail survives.
- Convert to text only at a boundary that requires it: a NAPI or MCP message, or a foreign API such as fontir's `Error::InvalidEntry`.
- A public error type cannot hold a private one. Export a wrapped error type alongside the public error that contains it.
- When new code calls an existing function that returns `String` errors, type that function's error first instead of wrapping the string again. Inherited stringly errors spread through every caller that adapts to them.

## Lookups and ids

- Lookups take ids by reference: `fn glyph(&self, id: &GlyphId)`. Ids are `String` newtypes; a by-value parameter forces every caller that keeps its id to clone it. Take an id by value only when the function stores or returns it.
- Never pass `&id.clone()`; borrow the id you have.
- Never clone an id only to build an error that is probably not returned. Use `ok_or_else` or the helpers above, which format the id only on failure. `ok_or(CoreError::X(id.clone()))` clones on every call, including successful ones.
- `Option` lookups (`font.glyph(id)`) are for "absent is a normal answer". Use `require_*` when absence is an error for this caller.

## Arithmetic and conversions

- Lengths, offsets, and counts that reach packed buffers use checked arithmetic with `.or_overflow()?`. Keep the `checked_add`/`checked_mul` visible at the call site.
- Integer narrowing uses `try_from` with `.or_overflow()?` or `length::to_u32`. Never use `as` for a narrowing conversion that can lose data.
- Bit-packed fields with a limit below their integer type go through `length::within(value, MASK)?`.

## Use the language

Let the type system state intent instead of comments, flags and tuples. Clippy enforces some of this (see `[workspace.lints.clippy]`); the rest is for review.

- **An enum, not a `bool`, for any choice with consequences.** `persist(change_set, AfterPersist::KeepUnsaved)` says what happens; `persist(change_set, false)` doesn't, and a `!flag` deep inside can silently discard data. Keep `bool` for genuine yes/no facts (`is_closed`, `smooth`).
- **Collect into domain types.** A collection type that callers build in loops implements `FromIterator` and `Extend`, so `let location: DesignLocation = axes.map(|a| (a.id(), a.default())).collect();` replaces `let mut location = DesignLocation::new(); for … { location.set(…) }`.
- **Name a type instead of a tuple** once it has three fields, is returned from a function, is stored in a collection, or is destructured with `_` placeholders. Points are `kurbo::Point`, not `(f64, f64)`.
- **A method, not a free function**, when the first argument is the owner: `font.master_layers(glyph)`, not `master_layers(font, glyph)`. Extension traits are fine across crates.
- **Entity kinds are an enum.** `EntityKind::Glyph` with `Display`, never `kind: "glyph"` or a `kind: &str` parameter, so kinds can't drift and callers can match them.
- **Repeated conversion shapes get one helper.** `.into_iter().map(Into::into).collect()` written ten times in a `From` impl becomes `convert_all(v)`; `changed.then(|| read()).transpose()?` becomes `if_changed(changed, read)?`.
- **Let the type do the adapting.** When a call site needs `.to_string()`, `into_inner()`, `from_raw(…)` or a `.map(…)` to pass a value along, implement the trait instead: ids implement `ToSql`/`FromSql` (`params![glyph.id()]`, `row.get("glyph_id")?`), and conversions implement `From`/`Into`.
- **Name the intent with a constructor.** `font.location_at(&coordinates)` and `font.default_location()` say what a value is; a `zip`/`map`/`collect` at the call site says how it's built.
- **Method paths over closures** that only call a method: `.map(Axis::id)`, not `.map(|axis| axis.id())`.
- **Points and vectors are `kurbo::Point`/`Vec2`**, and blending uses their operators (`point += weight * master_point`), not paired `x`/`y` arithmetic.
- **Prefer `let … else`, `if let` chains (edition 2024) and early returns** over nested `match` or `if let`, and name non-trivial intermediate values.

## Data structures

An edit should cost what the edited thing costs, not what the font costs. A `Font` is copied on the first write of every edit, so whatever it holds is copied or rescanned on every keystroke.

- **Answer a repeated query from an index, not a scan.** A lookup that walks every glyph, layer, group or pair (`iter().find(…)`, `iter().filter(…).collect()`) is a missing index. Keep one beside the data and update it where the data changes: `FontIndex` maps layers to owners and component bases to the layers that use them; `KerningGroups` maps each glyph to its groups.
- **Declare indexes, don't hand-maintain them.** Indexes that must agree are fields of one type, like `FontIndex`: a `UniqueIndex` for each key that may be held once, a multimap for the rest. One entries type (`IndexEntries`) says what an item files under each index, so inserting and removing are written once. Insert into a copy, which is O(1) for persistent collections, and keep it only on success; a rejected edit then leaves the font unchanged without a separate validation pass.
- **Wrap third-party collections.** Font state that grows with the font uses the persistent collections in `ir/persistent.rs` (`PersistentMap`, `PersistentSet`, `UniqueIndex`, `PersistentMultiMap`, `PersistentListMultiMap`, `PersistentOrdMap`, `PersistentVec`), which copy in O(1) and change in O(log n). Only that module names the backing crate; add the operation you need there instead of reaching through to `imbl`.
- **Collect a query's result into a type that states its order and uniqueness**, such as a `BTreeSet`, rather than pushing, sorting and deduplicating a `Vec`.
- **Change only what changed.** Compare persistent copies with `ptr_eq` before walking them, and diff two versions of a collection rather than rebuilding everything derived from it.

## Rules the editor needs

When the editor needs a shift-font rule synchronously, write it as a plain-data function in shift-font that native callers use, and export that function from `crates/shift-wasm`. Don't write a second Rust version for WebAssembly. The export only converts numbers to and from shift-font types; "Choosing a route" in `crates/shift-wasm/docs/DOCS.md` says what belongs there and what may stay in TypeScript.

## Review checklist

- [ ] No `CoreError::*NotFound`, `SlugError::LengthOverflow`, or `StoreError::MissingEntity` built inline where a helper above applies.
- [ ] No other crate's error variant named at a call site.
- [ ] No id cloned on a lookup's success path just for its error.
- [ ] No new `Result<_, String>`, `{ message: String }` error variant, or `.to_string()` of an error before a text boundary.
- [ ] Code that calls a function with `String` errors types that error rather than wrapping the string.
- [ ] Any error built at two or more sites for the same reason has one helper, with Rustdoc and a test.
- [ ] No new `bool` parameter for a choice with consequences; no new `kind: "…"` string.
- [ ] Collections built in loops implement `FromIterator`/`Extend` and are collected.
- [ ] No tuple of three or more fields returned, stored or destructured with `_`; no free function whose first parameter is its owner.
- [ ] No scan of the whole font for a query an edit repeats; indexes that must agree are declared on one type and updated through a copy; no `imbl` outside `ir/persistent.rs`.
- [ ] `cargo fmt`, `cargo clippy` for the affected crates, and their tests pass.
