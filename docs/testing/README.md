# Testing Quality Standards

This repository treats test quality as a first-class engineering practice.

See `docs/testing/FOLLOWUPS.md` for outstanding post-hardening tasks.

## Required CI gates

- `pnpm test:lint`: desktop oxlint safety gate (`typescript/no-explicit-any`) for `src/**/*.test.ts` and `src/renderer/src/testing/**/*.ts`
- `pnpm test:typecheck`: strict test type checking from `apps/desktop/tsconfig.testing.json` (package-scoped boundary)
- `pnpm test:unit`
- `pnpm test:integration`

## Typecheck scope

- `apps/desktop/tsconfig.testing.json` includes all desktop tests (`apps/desktop/src/**/*.test.ts`) plus shared test helpers (`apps/desktop/src/renderer/src/testing/**/*.ts`).
- Strictness ratchets enabled:
  - `exactOptionalPropertyTypes`
  - `noImplicitOverride`
  - `noUncheckedIndexedAccess`

## Targeted test runs

- Root-invoked targeted Vitest runs are supported via root `vitest.config.ts` project wiring:
  - `pnpm exec vitest run apps/desktop/src/renderer/src/lib/transform/Transform.test.ts`

## Coverage status

- Turbo `test` task outputs are currently configured as empty (`outputs: []` in `turbo.json`) because coverage artifacts are not emitted by default in this phase.
- Coverage thresholds and artifact publishing remain deferred until a dedicated coverage lane is wired.

## Core conventions

- Keep tests easy to scan: Arrange -> Act -> Assert.
- Prefer typed builders/fixtures over inline mock mega-setup.
- Reuse production types (`EditorAPI`, `CommandContext`, `GlyphSnapshot`, etc.) from source modules.
- Build scenarios around a shared `TestEditor` helper for integration-style editor tests.
- Keep helpers focused and composable so tests read like behavior specs, not setup scripts.
