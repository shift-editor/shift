---
name: shift-docs
description: Route Shift documentation, architecture notes, and tickets correctly. Use when Codex is about to create or move docs, write an architecture plan, capture a design decision, create a ticket, or update repo documentation for Shift.
---

# Shift Docs

Use the right destination for the artifact.

## Routing

- Stable repo documentation belongs in `docs/` or the module's canonical `DOCS.md`, following `docs/architecture/index.md`.
- Tickets, design scratchpads, future-work plans, and exploratory architecture proposals do not belong in repo `docs/`.
- Put tickets and exploratory plans in Obsidian under `~/Documents/KostyaVault/projects/shift/`, or open a GitHub issue when the user asks for a tracked issue.
- Do not create `CONTEXT.md` files.

## Before Writing

1. Read `docs/architecture/index.md` when changing stable repo documentation.
2. If the artifact is a ticket, plan, or unresolved proposal, route it to Obsidian or GitHub instead of `docs/`.
3. If unsure whether something is stable documentation or a ticket, ask briefly before writing.
