# shift-scan

<!-- reviewed: 2026-11-02 review-every: 90d -->

Reads every crate's syntax tree with `syn` and reports Rust structure clippy can't see: duplicated types and rules, names that break the house style, panics that reach Node, weak tests. Each kind's count per crate is held to `baseline.json`, so CI blocks new hits and every fix lowers a visible number.

## Architecture Invariants

- **Exact, not textual.** Every kind matches syntax (`syn` items, expressions and attributes), never a regex over source text.
- **The baseline only goes down.** `--check` fails when any kind's count in any crate and scope differs from `baseline.json`: a rise lists every hit in that crate and scope, a fall asks for `--update`. A kind with no hits left is printed as ready to become a hard rule. This matches `scripts/clippy-ratchet.mjs` and `clippy-ratchet.json`.
- **Library and test code are scanned apart.** Library kinds read each file with its `#[cfg(test)]` items removed (`syntax::without_tests`); test kinds read `#[cfg(test)]` modules, `tests.rs`, `*_tests.rs`, `test_support.rs`, `src/**/tests/` and the crate's `tests/`. A kind's scope (`src` or `tests`) is fixed by the kind (`Kind::scope`).
- **Report mode never fails.** `pnpm scan:rust` and `--since <rev>` print findings and exit 0; only `--check` fails.

## Codemap

```text
crates/shift-scan/
  baseline.json        Each kind's count per crate and scope, one line per crate
  src/
    main.rs            Options (--since, --kind, --check, --update) and the run
    finding.rs         Kind, Scope, Finding, Report
    baseline.rs        Counts: read, compare, check and update the baseline
    crate_scan.rs      CrateScan: one crate's files and its per-crate kinds
    file_scan.rs       method-candidate, long-chain, error mappings, conversions
    signature.rs       Names and signatures: get-prefix through owned-id-accessor
    errors.rs          stringly-error, inline-not-found, panicking-conversion
    runtime.rs         napi, parallel collects, leaks, recursion, linear lookups
    types.rs           duplicate-type and type-name-collision
    duplicate.rs       duplicate-body; body likeness for repeated-test-helper
    layout.rs          crate-header, large-inline-tests
    test_code.rs       The test kinds, except test-only-pub
    test_only_pub.rs   test-only-pub
    syntax.rs          Shared syntax questions
```

## Key Types

- **`Kind`** — one reported pattern, named in kebab case (`Kind::as_str`) for `--kind` and the baseline.
- **`Finding`** — a file, line, kind and detail; `crate_name()` is the directory after `crates/`.
- **`Counts`** — findings counted by kind, crate and scope; the baseline's in-memory form.
- **`CrateScan`** — one crate's parsed files, each with a `Role` (library, unit tests, integration tests).

## How it works

`main` scans each `crates/*/src` with `CrateScan::read`, which also reads the crate's `tests/`. Per-crate kinds come from `CrateScan::findings`; kinds that compare across the workspace (`duplicate-body`, `duplicate-type`, `type-name-collision`, `repeated-test-helper`, `test-only-pub`) are computed in `main` from what each crate hands back. Report mode prints `path:line<TAB>kind<TAB>detail`; `--check` and `--update` count the findings with `Counts`.

### Kinds

| Kind | Scope | Reports |
| --- | --- | --- |
| `method-candidate` | src | A free function whose first argument is a type of the same crate |
| `trait-candidate` | src | The same public method name and arity on three or more types |
| `long-chain` | src | A method chain of six or more steps that walks a collection |
| `repeated-error-mapping` | src | One error built by `ok_or_else`/`map_err` three or more times in a file |
| `field-copy-conversion` | src | A `From`/`TryFrom` literal copying four or more fields off its parameter |
| `duplicate-body` | src | A function body alike one elsewhere: the same tokens or the same arithmetic |
| `collect-turbofish` | src | `collect::<Vec<_>>()` where the field, argument or return type fixes it |
| `duplicate-type` | src | A struct or enum whose field or variant names match another's, or 80% of the larger |
| `type-name-collision` | src | A struct or enum name declared more than once in the workspace |
| `get-prefix` | src | A public `get_*` function (not `get_mut`, `get_or_*`, `get_index`) |
| `iter-suffix` | src | A public `*_iter` function |
| `ctor-with-prefix` | src | An associated `with_*` function without `self` (not `with_id`, `with_capacity`) |
| `id-param-name` | src | A `FooId` parameter named `foo` |
| `generic-suffix` | src | A type named `*Data`, `*Info` or `*State` |
| `stringly-error` | src | `Result<_, String>`, an error variant with a `message` field, an error variant built from `format!` or `error.to_string()`, or `.map_err` to text |
| `inline-not-found` | src | A `*Error::*NotFound` or `MissingEntity` built outside a `require_*`/`or_*` helper |
| `tuple-return` | src | A function returning a tuple, bare or in `Result`/`Option` |
| `panicking-conversion` | src | An `impl From`, `Default`, `Display`, `Index` or other infallible trait that can panic |
| `napi-without-catch-unwind` | src | An exported `#[napi]` function without `catch_unwind` |
| `parallel-first-error` | src | A parallel iterator collected into a `Result`, or `try_for_each` on one |
| `leaked-static` | src | `Box::leak`, `String::leak` or `.leak()` |
| `unguarded-recursion` | src | A function calling itself with no depth, budget, visited set or cycle check in sight |
| `owned-id-accessor` | src | An id accessor that clones the id it returns |
| `linear-lookup` | src | `find`/`position` comparing an id or name |
| `large-inline-tests` | tests | An inline test module over 300 lines |
| `crate-header` | src | A crate root with no `//!` header |
| `test-calls-private` | tests | A unit test calling a non-`pub` function its own test module doesn't define |
| `test-only-pub` | src | A public function only test code names (napi, WebAssembly and `test_support` exempt) |
| `long-test` | tests | A test body over 40 lines |
| `near-duplicate-tests` | tests | A test with at least 85% of its token pairs in common with another in its file |
| `repeated-test-helper` | tests | A test helper defined in two or more test files by name, or with an alike body |
| `weak-error-assert` | tests | `assert!(r.is_err())`, or an error's `to_string().contains(..)` |
| `test-setup-copy` | tests | A test opening with the same two statements as four or more others in its crate |

## Workflow recipes

```bash
pnpm scan:rust                          # every finding
pnpm scan:rust --kind get-prefix        # one kind
pnpm scan:rust --since origin/main      # findings in files a branch changed
pnpm scan:rust --check                  # what CI runs
pnpm scan:rust --update                 # lower the baseline after a fix
```

Adding a kind: add a `Kind` variant (doc comment, `as_str`, `ALL`, `scope`), report it from the module it belongs to, add a test in that module, add its row above and in the `add-lint` skill, then `pnpm scan:rust --update`.

## Verification

```bash
cargo test -p shift-scan
cargo clippy -p shift-scan --all-targets -- -D warnings
pnpm scan:rust --check
```

## Gotchas

- A cross-crate kind counts in each crate it touches: a new type alike one in another crate raises both crates' `duplicate-type`.
- Editing shift-scan's own tests can move its own counts (`long-test`, `near-duplicate-tests`); run `--update` with the change.
- `test-calls-private` matches calls by name, skipping common standard method names, so a crate's non-`pub` function named like another type's method can be counted.

## Related

- [`.agents/skills/add-lint/SKILL.md`](../../../.agents/skills/add-lint/SKILL.md) — when a pattern becomes a kind
- [`.agents/skills/rust/SKILL.md`](../../../.agents/skills/rust/SKILL.md) — the rules the kinds check
