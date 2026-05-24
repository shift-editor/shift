---
name: rust-bridge-boundaries
description: Use when changing Rust bridge/API types, NAPI bindings, generated TypeScript bridge shapes, document lifecycle, persistence results, metadata normalization, or cross-crate data transfer in Shift. Guides which crate should own domain data, wire DTOs, NAPI wrappers, and bridge behavior.
---

# Rust Bridge Boundaries

Use this before editing Rust bridge/API code or adding data that crosses from Rust into TypeScript.

## Crate Responsibilities

- `shift-ir`: canonical font data, domain identity, persisted model invariants.
- `shift-edit`: editing/session behavior over IR.
- `shift-backends`: format read/write/export implementations.
- `shift-wire`: bridge-neutral DTOs, transport-facing shapes, normalization rules, and conversions that would matter to any frontend or bridge.
- `shift-wire::bridges::napi`: NAPI-only wrappers, `#[napi]` annotations, `ts_type` hints, typed arrays, JS-compatible field quirks, and mechanical conversion to/from `shift-wire`.
- `shift-bridge`: document lifecycle, active edit sessions, revision/version behavior, async tasks, orchestration, and public NAPI method bodies.
- `packages/types`: generated/public TypeScript bridge types.
- `apps/desktop`: renderer domain models and UI flows.

## Placement Rules

- If a type or normalization rule would also matter to another frontend or bridge, put it in `shift-wire`, not `shift-bridge`.
- If a shape only exists because NAPI needs annotations or JS-compatible representation, put it in `shift-wire::bridges::napi`.
- If code mutates document/session state, bumps revisions, snapshots saves, or coordinates async work, keep it in `shift-bridge`.
- Keep NAPI method bodies thin: convert NAPI input to wire/domain data, run bridge behavior, then convert wire/domain output back to NAPI.
- Do not duplicate field-by-field mapping in `shift-bridge` when the mapping can live next to the source/target type.

## Checklist

1. Identify whether the new type is domain, wire, NAPI, or bridge behavior.
2. Add bridge-neutral DTOs and normalization in `shift-wire` when applicable.
3. Add NAPI wrappers/conversions in `shift-wire::bridges::napi`.
4. Keep `shift-bridge` focused on lifecycle and revision semantics.
5. Update generated TypeScript bridge types when NAPI output changes.
6. Add tests at the lowest layer that owns the behavior.
