---
name: rustdoc
description: Add or revise source-level Rustdoc for Shift Rust APIs. Use before writing or editing documentation comments in `.rs` files, especially for public or crate-visible APIs, domain structures, compiler adapters, persistence boundaries, trait implementations, unsafe code, or any API where ownership, units, coordinate spaces, mutation, I/O, sparse behavior, failure modes, panics, or concurrency are easy to misunderstand.
---

# Rustdoc — Source API Contracts

Write Rustdoc as the stable contract a caller or maintainer needs without reconstructing the implementation.

Use `///` immediately before an item and `//!` at the start of a module or crate. Let Rust's types describe shape; document semantics the type system cannot express.

## Runbook

1. Identify the boundary and audience: caller, implementer, compiler adapter, persistence layer, or maintainer.
2. Read the surrounding module, relevant callers, and behavior tests before describing the contract.
3. Start with one short sentence stating what the item represents or does.
4. Add only applicable details: ownership, snapshotting, mutation, I/O, units, coordinate domain, fallback, ordering, concurrency, performance, or invariants.
5. Add conventional sections when required:
   - `# Errors` for observable failure conditions.
   - `# Panics` for conditions that actually panic.
   - `# Safety` for every `unsafe` API, stating the caller's obligations.
   - `# Examples` only when call order, conversion, or output is non-obvious.
6. Link related APIs with intra-doc links such as [`Font`] or [`Self::export`].
7. Delete implementation trivia, current-caller anecdotes, migration history, and statements already obvious from the signature.

## What To Document

Prioritize contracts that Rust cannot encode directly:

- **Ownership and lifetime semantics** — owned snapshot versus live view, aliasing, cloning, and who may mutate a result.
- **Effects and atomicity** — filesystem or database I/O, shared-state mutation, transaction boundaries, and partial-failure behavior.
- **Units and coordinate domains** — font units, user coordinates, design coordinates, normalized coordinates, and mapping direction.
- **Resolution and sparsity** — exact lookup versus fallback, missing layer versus empty layer, and default-source requirements.
- **Ordering and identity** — stable ordering, ID preservation, minted identity, and when a value becomes stale.
- **Failures** — error conditions, panic preconditions, cancellation, and unsupported input.
- **Concurrency and performance** — thread assumptions, blocking work, hot-path suitability, and important complexity.

Document `pub(crate)` and private items when they form an architectural seam or carry a non-obvious invariant. Do not document obvious constructors or mechanical work wrappers merely because they are visible within the crate.

## Style Rules

- Open with a direct contract sentence; avoid “This function” and “This struct.”
- Prefer stable domain language over current implementation wiring.
- Do not restate parameter or field types in prose.
- Document fields individually only when their units, ownership, valid range, or meaning is not encoded by the field name and type.
- Use backticks for values and syntax; use intra-doc links for Rust items.
- Put module-wide invariants in one `//!` comment instead of repeating them on every item.
- Keep algorithmic rationale in ordinary `//` comments near the algorithm, not in the public contract.
- Do not copy documentation from an implemented trait. Describe Shift-specific adapter semantics on the implementing type or module.
- Do not use Rustdoc as a TODO list, changelog, ticket, or warning to future maintainers.
- Do not promise behavior more strongly than tests and implementation support.

## Conventional Sections

Use headings exactly as Rust tooling and readers expect:

```rust
/// Writes a TTF compiled from an immutable snapshot of the supplied font.
///
/// The destination is replaced atomically after compilation succeeds.
///
/// # Errors
///
/// Returns [`ExportError`] when the source cannot be represented, compilation
/// fails, or the destination cannot be replaced.
pub fn export(/* ... */) -> Result<FontExportResult, ExportError> {
    // ...
}
```

For panics, document the actual precondition rather than writing a generic disclaimer:

```rust
/// Returns the default source.
///
/// # Panics
///
/// Panics when the font has no default source.
```

Every `unsafe` item needs a precise caller obligation:

```rust
/// Reads a point from the packed geometry buffer.
///
/// # Safety
///
/// `index` must address a fully initialized point in `buffer`.
```

## Examples and Links

Examples are executable contracts, not decoration.

- Prefer a compiling doctest with assertions.
- Use hidden `#` lines for setup when that keeps the lesson focused.
- Use `no_run` for filesystem or process examples; avoid `ignore` unless the example fundamentally cannot compile in docs.
- Keep one concept per example and omit examples for trivial accessors.
- Run doc tests after adding an example.

Use links that Rustdoc can resolve:

```rust
/// Creates the snapshot consumed by [`FontExporter::export`].
///
/// See [`FontView`] for the borrowed authoring interface.
```

## Validation

After editing Rustdoc:

1. Run `cargo fmt --all -- --check`.
2. Run the affected crate's tests, including doc tests when examples changed.
3. Run `RUSTDOCFLAGS="-D rustdoc::broken_intra_doc_links" cargo doc --workspace --no-deps --document-private-items` for new or changed links.
4. Run Clippy for affected crates when documentation changes accompany Rust code changes.

Do not enable workspace-wide `missing_docs` as part of an unrelated change. Introduce lint policy separately after auditing the existing baseline.

## Checklist

- [ ] The first sentence states a useful contract.
- [ ] The comment adds information not already encoded by the signature.
- [ ] Units, coordinate spaces, ownership, sparse behavior, and effects are explicit where relevant.
- [ ] Every documented failure, panic, and safety obligation matches reality.
- [ ] Intra-doc links resolve and examples compile.
- [ ] No caller name-drops, implementation history, TODOs, or duplicated trait docs.
