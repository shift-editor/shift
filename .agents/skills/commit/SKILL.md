---
name: commit
description: Canonical rules for writing git commits in the Shift codebase. Use whenever the user asks to commit, stage and commit, create a pull request that requires commits, or draft a commit message. Enforces Conventional Commits, release-note quality, concise subjects, and logical commit boundaries.
---

# /commit — How Shift commits are written

The goal is a `git log --oneline` that explains the project and gives Release Please clean input.

## Commit syntax

Every subject uses Conventional Commits:

```text
<type>[optional scope][optional !]: <concise imperative description>
```

Examples:

```text
feat: add isolated Nightly builds
fix(workspace): preserve edits after failed export
refactor(renderer): share retained glyph ownership
feat(document)!: reject legacy workspace schemas
```

Use `!` or a `BREAKING CHANGE:` footer only when callers, documents, or user workflows must change. Alpha permits breaking changes, but the commit must still explain them.

## Allowed types

| Type       | Use for                                            | Public changelog |
| ---------- | -------------------------------------------------- | ---------------- |
| `feat`     | New user-visible functionality                     | Yes              |
| `fix`      | User-visible bug fix                               | Yes              |
| `perf`     | Measurable performance improvement                 | Yes              |
| `refactor` | Code change with no intended behavior change       | No               |
| `test`     | Tests without production behavior changes          | No               |
| `docs`     | Documentation only                                 | No               |
| `build`    | Packaging, build scripts, native compilation       | No               |
| `ci`       | CI and release workflows                           | No               |
| `style`    | Formatting only, not UI appearance                 | No               |
| `chore`    | Dependencies, tooling, and repository housekeeping | No               |

Release Please uses merged conventional commits to update `CHANGELOG.md`, versions, tags, and GitHub release notes. Write `feat`, `fix`, and `perf` subjects for users rather than as file-level implementation summaries.

Do not manually bump the product version or edit generated release sections in an ordinary feature pull request. Release Please owns those changes in its release pull request. Use a `Release-As: X.Y.Z` footer only after the user explicitly approves a milestone transition.

## Subject rules

- Maximum 72 characters including type and scope; aim for 50.
- Lowercase after the colon.
- Imperative mood: `add`, `preserve`, `reject`; not `added` or `adds`.
- No trailing period, emoji, agent prefix, or generated-by attribution.
- Avoid file paths and symbol names unless they are essential to understanding the change.
- Never prefix a subject with `[codex]` or another agent label.

## Commit bodies

Most commits do not need a body. Add one when the constraint, consequence, migration, or reason is not clear from the subject.

- Leave one blank line after the subject.
- Wrap prose near 72 characters.
- Explain why and non-obvious consequences; do not narrate the diff.
- Put `BREAKING CHANGE:` and `Release-As:` footers after the body when approved and required.

## Logical boundaries

Every commit is one reviewable change. Keep production code with the tests and focused documentation that prove or explain it.

Split when changes have independent reasons to exist, especially:

- unrelated subsystems or behaviors;
- file moves mixed with later logic changes;
- generated output independent of hand-written changes;
- broad formatting mixed with behavior;
- repository tooling unrelated to the product change.

When the correct split is unclear, propose the subjects and path groups before staging. Do not create artificial test-only commits when the tests belong to the behavior they cover.

## Process

1. Confirm the user's stated goal. Ask for a one-line explanation only when the purpose is genuinely unclear.
2. Inspect `git status`, unstaged and staged diffs, and recent commit subjects.
3. Identify secrets, generated files, unrelated work, and the logical commit boundaries.
4. If multiple commits are needed and the user has not already approved the plan, propose the ordered subjects and wait.
5. Run the focused tests and repository checks appropriate to each change.
6. Stage explicit paths or hunks. Never use `git add .` or `git add -A`.
7. Commit without bypassing hooks.
8. Inspect `git status` and the resulting commit after each commit.

A request to create a pull request authorizes the commits needed for the clearly stated PR goal. It does not authorize including unrelated dirty work.

## Hard rules

- Never commit unless the user asked for a commit or for a pull request that requires it.
- Never bypass hooks with `--no-verify` or disable signing unless the user explicitly requests it.
- If a commit hook fails, fix the cause and rerun the commit. If a committed change later needs correction, add a new commit rather than amending unless the user asks to rewrite local history.
- Never commit credentials, tokens, certificates, `.env` files, or suspicious generated secrets.
- Never push unless the user asks to push or create/update a pull request.
- Never add agent attribution or co-author trailers unless the user asks.
