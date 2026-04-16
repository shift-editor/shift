---
name: docs
description: Update or create DOCS.md files for Shift subsystems. Use this skill whenever the user asks to update docs, refresh documentation, create a DOCS.md, write module documentation, or says "update docs for X". Also trigger after completing a large feature when Claude.md says to update docs — check if any DOCS.md in the affected subsystem needs refreshing.
---

# /docs — Update or Create Module Documentation

The goal is documentation that helps agents and contributors understand constraints they cannot discover by reading source code.

## Before writing

1. Read `docs/architecture/index.md` to find the canonical doc for the subsystem
2. Read the current DOCS.md if one exists
3. Read the module's source code to understand what has actually changed
4. If creating a new DOCS.md, confirm with the user first — this skill defaults to updating existing docs

## DOCS.md section order

Every DOCS.md follows this structure. Omit empty sections but preserve the order.

```markdown
# Module Name

One-sentence purpose.

## Architecture Invariants

## Codemap

## Key Types

## How it works

## Workflow recipes

## Gotchas

## Verification

## Related
```

## Writing each section

### Architecture Invariants

This is the most valuable section because it captures knowledge that is invisible in code. A contributor can read every line of source and still violate an invariant, because invariants describe absences, performance motivations, and semantic distinctions that only make sense with historical context.

Each invariant states a rule and explains why it exists:

> **Architecture Invariant:** Rust is never touched during the draft hot path. `GlyphDraft.setPositions` calls only `glyph.apply()` — a JS-only signal update. Rust sees the final result once when `finish()` calls `bridge.sync()`. This exists because NAPI struct marshaling at thousands of points per frame causes ~450ms frames + GC pressure.

Good invariants describe:
- What never happens and why ("X never imports Y because Z")
- Performance-motivated design choices ("uses flat arrays, never JSON, because Y")
- Semantic distinctions invisible in types ("`$glyph` fires on identity changes, not data changes")

Bad invariants just restate what the code does ("X calls Y", "X extends Z"). If you can see it by reading the source, it does not belong here.

Use `**CRITICAL**:` labels sparingly — only for rules that will silently break things or waste hours if violated. These are not style preferences; they are landmines.

### Codemap

A tree showing key files with one-line purposes. Skip test fixtures, generated files, and barrel re-exports. The point is orientation, not an exhaustive listing.

```
module/
├── Foo.ts         — one-line purpose
├── Bar.ts         — one-line purpose
└── types.ts       — one-line purpose
```

### Key Types

Only types that matter for understanding the module's contract. Reference by symbol name (`EditSession`, `BaseTool`), not file path. Symbol names survive refactors; paths break.

### How it works

Brief narrative explaining data flow and lifecycle. Focus on design rationale for non-obvious choices — "we do X because Y, not because Z." This is not an API dump listing every method signature.

### Workflow recipes

Step-by-step instructions for common modifications. Include which symbols to touch and what verification to run. Be specific enough that someone unfamiliar with the module can follow along:

```markdown
### Adding a new tool

1. Create a class extending `BaseTool` in `lib/tools/`
2. Define `behaviors` array — first `canHandle` match wins
3. Implement `activate()` to enter a reactive state (e.g. `"ready"`)
4. Register in `ToolRegistry`
5. Verify: `pnpm typecheck && pnpm test`
```

### Gotchas

Things that have bitten people. Performance traps. Known edge cases. These are experiential — the kind of thing someone would tell a new teammate over coffee.

### Verification

What to run after changing this module. Be specific about which commands and what they check.

### Related

Other modules this one connects to, referenced by symbol name with a brief note on the relationship.

## What not to write

These patterns weaken documentation and cause maintenance burden:

- **API dumps** — listing every method with its signature. The code is the API reference; docs should explain what the code cannot.
- **Duplicating Claude.md** — if a rule is in the root constitution, don't repeat it. A contributor who read Claude.md and then reads your DOCS.md shouldn't see the same rule twice.
- **Exhaustive file lists** — listing every file in a directory rots immediately. The codemap should cover key files only.
- **Generic descriptions** — "This module handles X" without explaining why it handles X this particular way. The interesting part is always the design choice, not the responsibility statement.
- **Cross-cutting architecture** — narratives spanning multiple subsystems belong in `docs/architecture/`, not in one module's DOCS.md.

## After writing

1. Verify backtick-quoted symbols still exist — grep for each `PascalCase` symbol in the doc
2. Verify markdown links resolve to real files
3. Run `python3 scripts/context-drift-check.py` to validate the full docs system
4. Prefer small, accurate updates over comprehensive rewrites. A doc with three correct invariants beats one with ten stale ones.

## Scope boundaries

- Do not modify `Claude.md` — it is manually curated
- Do not create `CONTEXT.md` files — banned by Claude.md
- Cross-cutting architecture docs go in `docs/architecture/`, not module DOCS.md
- Do not create new DOCS.md files without an explicit request from the user
