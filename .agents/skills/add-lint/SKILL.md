---
name: add-lint
description: Turn a code pattern the user doesn't want into a check that finds it without them — an oxlint rule in `scripts/oxlint/shift-plugin.mjs`, a workspace clippy lint, or a report in `shift-scan` (Rust) or `scan-ts` (TypeScript) — and clean up what it finds. Use when the user says "I don't like X", "we keep doing X", "add a lint/rule/check for X", "make this a rule", "scan for X", "can we catch this automatically", or when the same review comment comes up a second time. Also use to run the scanners on a branch before review or before opening a pull request, and to count where a code pattern occurs across the tree (how many tests reach an internal, how many files do X) instead of grepping: extend a scanner kind or rule and report its hits.
---

# /add-lint — Catch a pattern once, not in every review

Every pattern the user has to point out twice should be found by a tool after that. A rule that
blocks is better than a report; a report is better than a reviewer remembering.

## 1. Pin the pattern down

Write a before/after for the pattern from real code (file:line), and one case that looks similar
but is fine. Show it with `show_code` and agree it with the user before writing the check: a rule
that flags the wrong thing teaches everyone to ignore it.

## 2. Pick where it lives

| The pattern is                                                                        | Put it in                                                                | Effect                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| Decidable in one TypeScript file, from syntax                                         | a rule in `scripts/oxlint/shift-plugin.mjs`, enabled in `.oxlintrc.json` | blocks in `pnpm lint:check` and CI |
| Covered by an existing clippy lint                                                    | `[workspace.lints.clippy]` in `Cargo.toml`                               | blocks in clippy and CI            |
| Covered by a clippy lint with too many hits to fix now                                | a key in `clippy-ratchet.json`                                           | blocks new hits per crate in CI    |
| Covered by an oxlint built-in or a plugin rule (`@shadcn/lint` for the design system) | `.oxlintrc.json` (the root, or a package's for its own rules)            | blocks                             |
| Needs other files, types, or a reviewer's judgement (TypeScript)                      | a kind in `scripts/scan/scan-ts.mjs`                                     | `pnpm scan:ts` reports             |
| Rust structure clippy can't see (free functions, shared shapes, chains)               | a `Kind` in `crates/shift-scan`                                          | ratcheted by `pnpm scan:rust --check` in CI |

Prefer the first row that fits. A scanner kind is right when some hits are correct code (a free
numeric helper, a cache that really is a cache), so it can't block outright. Its count per crate is
held to `crates/shift-scan/baseline.json` instead: CI fails when a count rises (listing the new
hits) or falls without `pnpm scan:rust --update`.

## 3. Count before enabling

Run the new check over the tree first (`pnpm lint:check`, `pnpm scan:ts --kind <kind>`,
`pnpm scan:rust --kind <kind>`) and report the count with a few real hits.

- **0 hits:** enable it as an error and stop.
- **A handful:** fix them in the same branch, one commit for the rule and one for the fixes.
- **Many:** ask. Usually the rule lands with its fixes in batches by area; never land a rule with
  a blanket disable. A disable comment on one line says why that line is the exception.

`lint:check` runs with `--deny-warnings`, so a `"warn"` rule blocks as well as `"error"`.

A clippy lint with many hits is ratcheted rather than enabled: add `"<lint>": {}` to
`clippy-ratchet.json` and run `pnpm lint:rust-ratchet --update`, which records today's hits per
crate. CI then fails when any count changes; each fix lowers the file, and at 0 the lint moves to
`Cargo.toml`.

## 4. Write it like the existing ones

- **oxlint rule:** copy the shape of a nearby rule in `shift-plugin.mjs` (`meta.messages` saying
  what to write instead, `create(context)` returning node visitors). Add `describe` cases to
  `scripts/oxlint/shift-plugin.test.mjs` for a flagged line and an unflagged look-alike; run
  `pnpm test:lint-rules`.
- **scan-ts kind:** add it to `KINDS`, check it in `FileScan#check` (or across files in
  `TsScan#findings`), add a test in `scripts/scan/scan-ts.test.mjs`; run `pnpm test:scan`.
- **shift-scan kind:** add a `Kind` variant (doc comment, `as_str`, `ALL`, `scope`), report it
  from the module its theme lives in (see `crates/shift-scan/docs/DOCS.md`), and add a test there.
  Add its line below and its row in the DOCS.md table. Then run:

  ```bash
  cargo test -p shift-scan
  cargo clippy -p shift-scan --all-targets -- -D warnings
  cargo fmt -p shift-scan
  pnpm scan:rust --update   # record its count in the baseline
  ```

  The kinds today:

  - `method-candidate` — a free function whose first argument is a type of the same crate
  - `trait-candidate` — the same public method name and arity on three or more types
  - `long-chain` — a method chain of six or more steps that walks a collection
  - `repeated-error-mapping` — one error built by `ok_or_else`/`map_err` three or more times in a file
  - `field-copy-conversion` — a `From`/`TryFrom` literal copying four or more fields off its parameter
  - `duplicate-body` — a function body alike one elsewhere: the same tokens or the same arithmetic
  - `collect-turbofish` — `collect::<Vec<_>>()` where the field, argument or return type fixes it
  - `duplicate-type` — a struct or enum whose field or variant names match another's, or 80% of the larger
  - `type-name-collision` — a struct or enum name declared more than once in the workspace
  - `get-prefix` — a public `get_*` function (not `get_mut`, `get_or_*`, `get_index`)
  - `iter-suffix` — a public `*_iter` function
  - `ctor-with-prefix` — an associated `with_*` function without `self` (not `with_id`, `with_capacity`)
  - `id-param-name` — a `FooId` parameter named `foo`
  - `generic-suffix` — a type named `*Data`, `*Info` or `*State`
  - `stringly-error` — `Result<_, String>`, an error variant with a `message` field, an error variant built from `format!` or `error.to_string()`, or `.map_err` to text
  - `inline-not-found` — a `*Error::*NotFound` or `MissingEntity` built outside a `require_*`/`or_*` helper
  - `tuple-return` — a function returning a tuple, bare or in `Result`/`Option`
  - `panicking-conversion` — an `impl From`, `Default`, `Display`, `Index` or other infallible trait that can panic
  - `napi-without-catch-unwind` — an exported `#[napi]` function without `catch_unwind`
  - `parallel-first-error` — a parallel iterator collected into a `Result`, or `try_for_each` on one
  - `leaked-static` — `Box::leak`, `String::leak` or `.leak()`
  - `unguarded-recursion` — a function calling itself with no depth, budget, visited set or cycle check in sight
  - `owned-id-accessor` — an id accessor that clones the id it returns
  - `linear-lookup` — `find`/`position` comparing an id or name
  - `large-inline-tests` — an inline test module over 300 lines
  - `crate-header` — a crate root with no `//!` header
  - `test-calls-private` — a unit test calling a non-`pub` function its own test module doesn't define
  - `test-only-pub` — a public function only test code names (napi, WebAssembly and `test_support` exempt)
  - `long-test` — a test body over 40 lines
  - `near-duplicate-tests` — a test with at least 85% of its token pairs in common with another in its file
  - `repeated-test-helper` — a test helper defined in two or more test files by name, or with an alike body
  - `weak-error-assert` — `assert!(r.is_err())`, or an error's `to_string().contains(..)`
  - `test-setup-copy` — a test opening with the same two statements as four or more others in its crate

## 5. Write the rule down where it's read

Add or update the rule's line in the skill that owns it (`typescript`, `rust`, `signals`,
`writing-tests`, `ui`, `jsdoc`) and end it with "Enforced by `shift/<rule>`" or "Reported by
`pnpm scan:ts --kind <kind>`". `AGENTS.md`'s anti-slop list holds only rules no tool checks;
remove a rule from it once a check covers it.

## Running the scanners on a branch

Before review, report only what the branch touches:

```bash
pnpm scan:ts --since origin/main
pnpm scan:rust --since origin/main
```

Treat each finding as a question, not a failure: say for each whether to fix it in the branch,
leave it (and why), or turn it into a rule.
