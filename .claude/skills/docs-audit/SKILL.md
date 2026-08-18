---
name: docs-audit
description: Adversarially fact-check DOCS.md files against the actual source code, verifying every concrete claim rather than trusting structure checks. Use when the user asks to audit docs, verify documentation accuracy, check whether docs are still true, or on a scheduled documentation review. This is the semantic layer the mechanical checkers cannot cover.
---

# /docs-audit — Adversarial Documentation Audit

`scripts/context-drift-check.py` proves referential integrity (links, symbols, commands, codemap paths, structure). It cannot prove that prose is TRUE. This skill is the semantic layer: read the doc, read the module, and try to refute every checkable claim.

## Scope

Given no arguments, audit the DOCS.md files whose `reviewed:` date is oldest or overdue (the checker's stale warnings list them). Given a module or doc path, audit that doc. A full-repo audit fans out one subagent per doc (they are independent — run them in parallel).

On a scheduled run, guard first — before installing dependencies or reading any docs:

```bash
git log --oneline --since='8 days ago' -- crates packages apps '**/docs/DOCS.md' docs/architecture
```

No output (or only commits whose changes are all outside those paths — CI config, lockfiles, release chores) means nothing meaningful changed: report "no source or docs commits since <date>; audit skipped" and stop. When there are meaningful commits, prioritize the docs whose modules those commits touched.

## Procedure per doc

1. Run the mechanical checkers first — don't spend audit effort on what they already catch:
   `python3 scripts/context-drift-check.py`, `node scripts/check-docs-fences.mjs`, `python3 scripts/check-invariants.py`.
2. Extract the doc's concrete checkable claims: architecture invariants, Key Types descriptions, Codemap one-liners, How-it-works statements, Gotchas, Workflow recipe steps. Prioritize the ~12 most load-bearing claims; cover long-standing content, not just recent edits.
3. Verify each claim by reading the actual source — never by plausibility. For behavioral claims (ordering, caching, skipping, round-trips), trace the code path; where cheap, verify numerically or by running the referenced test.
4. Classify: TRUE (verified), FALSE (contradicted — cite doc line and source file:line), MISLEADING/STALE (real symbols, wrong or superseded behavior), UNVERIFIABLE (pure rationale — fine, leave it).
5. Watch for the known rot patterns: superseded API narratives (per-method flows replaced by batch entry points), mechanisms attributed to the wrong symbol, behavior claims inverted by edge cases (wrapping, malformed input), and codemap entries for moved responsibilities.

## Reporting and fixing

- Report a per-doc tally (e.g. 11 TRUE / 1 FALSE / 2 MISLEADING) with details only for non-TRUE findings, each carrying doc line + contradicting source location.
- If asked to fix (or running as a scheduled audit): apply corrections per the `docs` skill, re-run the checkers, bump the doc's `reviewed:` date (the audit IS the attestation), and commit as `docs: ...` per the `commit` skill. Never invent content to fill a finding you did not verify.
- An audit that finds nothing wrong still bumps `reviewed:` — that is the point of the attestation.
