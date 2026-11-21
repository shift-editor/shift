# Constraints — strokes exploration (`explore/strokes`)

**Scope:** This file is **branch-local** under `explorations/strokes/`. A repo-root `CONSTRAINTS.md` would be an **upstream product decision**; until then, stroke work on this branch follows this contract.

**Last reviewed:** 2026-11-21 by Tasos

**Suggestion (not applied):** Add one line to [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md): *Read `explorations/strokes/CONSTRAINTS.md` before stroke work on `explore/strokes`. Do not weaken it to make a change pass.*

## Floor (always enforced, no setup required)

Diff-scoped guard patterns: constraint-driven-development skill → `references/floor-guard.md` (threshold weakened, test made easier, checker silenced, unfinished work, untracked exception).

- No new suppression comments: `@ts-ignore`, `eslint-disable`, `# noqa`, `# type: ignore`, and Shift oxlint suppressions unless tracked in **Exceptions** below.
- No unimplemented stubs: `throw new Error("Not implemented")`, empty `catch {}`.
- No skipped or deleted tests without a reason in the commit message.
- No secrets in source.
- This file does not get weakened to make a change pass.

## Repo gates (do not duplicate — point here)

Shift already enforces these. Stroke modules must stay green on them; details live in [AGENTS.md](../../AGENTS.md) and [.github/workflows/ci.yml](../../.github/workflows/ci.yml).

| Dimension | Rule | Checked by | Runs at |
| --- | --- | --- | --- |
| Types (TS) | Zero type errors | `pnpm typecheck` | Task end; CI job **Typecheck** |
| Lint (TS) | Zero errors from oxlint + Shift plugin | `pnpm lint:check` (local); CI **Lint (oxlint)** runs `pnpm test:lint` | Task end; CI |
| Format (TS/JS) | Oxfmt clean | `pnpm format:check` | Task end; CI |
| Rust format | `rustfmt` clean | `cargo fmt --all --check` | Task end; CI job **Rust Format** |
| Rust lint | No new clippy hits above ratchet | `pnpm lint:rust-ratchet` → `node scripts/clippy-ratchet.mjs` (`clippy.toml`, `clippy-ratchet.json`) | Task end; CI job **Rust Clippy & Tests** |
| Invariants | Architecture boundaries (e.g. NAPI) | `python3 scripts/check-invariants.py` | CI docs/invariants job |
| Doc drift | DOCS freshness and links | `python3 scripts/context-drift-check.py` | CI; hand-run before stroke doc commits |
| Rust deps | Licenses, advisories, sources | `cargo deny check` | CI job **Rust Dependencies** |
| Tests (full) | Workspace suites green | `pnpm test` (Turbo graph builds native first) | **Before each commit** on this branch; CI |
| Tests (focused) | Crates/packages touched by the task | e.g. `cargo test -p shift-font --lib stroke::`, `pnpm test:desktop <path>`, `pnpm test:native` as appropriate | **Task end (~90s budget)**; full suite still runs in CI |

**Enforcement cadence for stroke-specific rows below:** **warn** for the first two weeks after 2026-11-21 (**until 2026-12-05**), then **block** (same as repo gates).

Run repo commands inside the Nix dev shell: `nix develop --command <command>`.

## Stroke-specific rules (exploration)

| Dimension | Rule | Checked by | Runs at |
| --- | --- | --- | --- |
| Failures | No stroke solve failure turned into a **zero or empty** metric answer; per-contour failures **surface** (Rust owns the answer) | Code review + stroke tests | Task end |
| Tests | No skipped or deleted stroke tests without a reason in the commit message | Floor + `git diff` | Every commit |
| Architecture | No **TypeScript port** of a Rust stroke or metrics rule ([AGENTS.md](../../AGENTS.md)) | Review + `scripts/check-invariants.py` where applicable | Task end |
| Persistence | **Only** the per-font "Include stroke" switch is persisted — **never** ink sidebearings or ink bounds | Rust/store tests + review | Task end |
| Export parity (external) | **Planned:** `a-stroke-export` adds **Rust vs expanded-outline sidebearing parity** (outline the check owns the verdict, not the stroke test suite alone) | Future export fixture test in `shift-font` / export path | CI when landed |

Until **2026-12-05**, violations of the stroke-specific rows are called out in review and commit messages; after that date they block merge on this branch the same way repo gates do.

## Measured, not yet enforced

| Metric | Today | Direction |
| --- | --- | --- |
| Clippy outside ratchet (`node scripts/clippy-ratchet.mjs`) | **2** (`shift-cli/tests/support/mod.rs` dead code only); verified at `7caca0c11` on 2026-11-21 — earlier “15 hit” gate count miscounted stroke ink debt | must not grow |
| Ink read cost (~600-point stroked glyph, one read) | **17.27 ms** cold / **~14 µs** warm on 601-pt closed wavy ring (round 24, tol 0.25, `cargo test --release -- --ignored ink_read_cost_on_six_hundred_point_wavy_ring`, 2026-11-21): cold pays first solve + projection/assembly; **warm hits extent memo + stroke solve cache** (no projection/assembly/solver) | must not grow |

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
| --- | --- | --- | --- | --- | --- |