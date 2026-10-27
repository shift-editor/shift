---
name: add-lint
description: Turn a code pattern the user doesn't want into a check that finds it without them — an oxlint rule in `scripts/oxlint/shift-plugin.mjs`, a workspace clippy lint, or a report in `shift-scan` (Rust) or `scan-ts` (TypeScript) — and clean up what it finds. Use when the user says "I don't like X", "we keep doing X", "add a lint/rule/check for X", "make this a rule", "scan for X", "can we catch this automatically", or when the same review comment comes up a second time. Also use to run the scanners on a branch before review.
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
| Covered by an oxlint built-in or a plugin rule (`@shadcn/lint` for the design system) | `.oxlintrc.json` (the root, or a package's for its own rules)            | blocks                             |
| Needs other files, types, or a reviewer's judgement (TypeScript)                      | a kind in `scripts/scan/scan-ts.mjs`                                     | `pnpm scan:ts` reports             |
| Rust structure clippy can't see (free functions, shared shapes, chains)               | a `Kind` in `crates/shift-scan`                                          | `pnpm scan:rust` reports           |

Prefer the first row that fits. A scanner kind is right when some hits are correct code (a free
numeric helper, a cache that really is a cache), so it can't block.

## 3. Count before enabling

Run the new check over the tree first (`pnpm lint:check`, `pnpm scan:ts --kind <kind>`,
`pnpm scan:rust --kind <kind>`) and report the count with a few real hits.

- **0 hits:** enable it as an error and stop.
- **A handful:** fix them in the same branch, one commit for the rule and one for the fixes.
- **Many:** ask. Usually the rule lands with its fixes in batches by area; never land a rule with
  a blanket disable. A disable comment on one line says why that line is the exception.

`lint:check` runs with `--deny-warnings`, so a `"warn"` rule blocks as well as `"error"`.

## 4. Write it like the existing ones

- **oxlint rule:** copy the shape of a nearby rule in `shift-plugin.mjs` (`meta.messages` saying
  what to write instead, `create(context)` returning node visitors). Add `describe` cases to
  `scripts/oxlint/shift-plugin.test.mjs` for a flagged line and an unflagged look-alike; run
  `pnpm test:lint-rules`.
- **scan-ts kind:** add it to `KINDS`, check it in `FileScan#check` (or across files in
  `TsScan#findings`), add a test in `scripts/scan/scan-ts.test.mjs`; run `pnpm test:scan`.
- **shift-scan kind:** add a `Kind` variant (with `as_str`), report it from `FileScan` or
  `CrateScan`, and add a test in `crate_scan.rs`. Then run:

  ```bash
  cargo test -p shift-scan
  cargo clippy -p shift-scan --all-targets -- -D warnings
  cargo fmt -p shift-scan
  ```

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
