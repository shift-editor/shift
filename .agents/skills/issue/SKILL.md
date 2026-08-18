---
name: issue
description: Canonical rules for finding, creating, and updating Shift GitHub issues. Use whenever the user asks to file, create, open, update, triage, or search for an issue, or when substantial work needs an issue before a pull request. Prevents duplicates and defines acceptance criteria and pull-request closure semantics.
---

# /issue — How Shift issues are written

An issue records an unmet product or engineering outcome. It explains the problem and the truth that must become observable without prescribing an unnecessary implementation.

## Search before creation

Always search open and recently closed issues before creating one. Use several concise searches based on the user-visible behavior, domain terms, and likely title wording.

- Reuse a matching open issue rather than creating a duplicate.
- Reference a related issue when the scope overlaps but is not identical.
- Inspect a matching closed issue before deciding whether the new report is a recurrence, a regression, or distinct work.
- Never reopen or modify a closed issue without explicit user approval.

If an existing issue is adequate, return or update that issue instead of creating another.

## Title

Use a concise outcome-oriented title that stands alone in issue lists. The title should:

- describe the missing or incorrect behavior;
- use direct, specific wording;
- stay at or below 72 characters when practical;
- omit trailing punctuation, emoji, agent labels, and implementation trivia.

Issues do not require a Conventional Commit prefix. Use `fix:`, `feat:`, or another type only when it is already part of an established issue series.

## Body

Use the smallest body that makes the work testable:

```markdown
## Problem

What is missing, broken, unsafe, or difficult, and why it matters.

## Expected outcome

What should be observably true when the issue is complete.

## Acceptance criteria

- [ ] concrete, verifiable result
- [ ] important safety or compatibility boundary
```

Add reproduction steps, evidence, constraints, or out-of-scope notes only when they materially clarify the issue. Do not copy an implementation plan into the issue unless the implementation boundary itself is a requirement.

Acceptance criteria must describe behavior or durable repository outcomes. Do not use vague criteria such as “works correctly,” “tests pass,” or “code is clean.”

## Pull request linkage

Issue state has these meanings:

- **Open:** at least one accepted outcome remains unmet.
- **Closed by merge:** a pull request containing `Closes #N` merged to the default branch and fully satisfied the issue.
- **Referenced:** a pull request containing `Refs #N` contributes context or partial work; the issue remains open.
- **Reopened:** a human explicitly determined that the accepted outcome was not met or regressed.

Use `Closes #N` only when the pull request satisfies the complete issue. Use `Refs #N` for partial work, investigation, prerequisites, or related context.

## Creation process

1. Confirm the requested problem or outcome.
2. Search open and closed issues with multiple focused queries.
3. Inspect likely matches and decide whether to reuse, reference, or create.
4. Draft a concise title and body with verifiable acceptance criteria.
5. Check for credentials, private user data, unsupported claims, and accidental implementation commitments.
6. Create the issue with an explicit repository and a body file when requested or required for substantial pull-request work.
7. Return the issue URL, title, and any relationship to existing issues.

A request to create or file an issue authorizes the corresponding `gh issue create`. It does not authorize changing repository settings, labels, milestones, projects, assignees, or issue state unless the user explicitly asks.

## Hard rules

- Never create a duplicate merely to give a pull request something to close.
- Never fabricate reproduction steps, logs, acceptance criteria, labels, milestones, or relationships.
- Never include credentials, signing material, tokens, private paths, or sensitive user documents.
- Never close or reopen an issue without explicit authorization or the approved `Closes #N` merge transition.
- Never claim that a pull request fully resolves an issue when acceptance criteria remain unmet.
