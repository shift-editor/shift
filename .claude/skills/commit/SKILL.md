---
name: commit
description: Canonical rules for writing git commits in the Shift codebase. Use whenever the user asks to commit, stage and commit, or "make a commit" — and whenever you're about to draft a commit message. Enforces conventional prefixes, concise subjects, and splitting unrelated changes into separate commits.
---

# /commit — How commits are written in this codebase

The goal: a `git log --oneline` that reads like a changelog. Each line tells you what changed and why in under ~70 characters, with a prefix that lets you grep for features vs fixes vs refactors.

## The rule

**Every commit subject is `<type>: <concise description>`. Every commit is one logical change.**

If you can't describe the change in one short clause, it's probably two commits.

## Step 0 — ask the user before drafting

Before writing any commit message, **ask the user to describe the changes in their own words**. They know the why; you only see the diff. A one-line description from the user beats five minutes of you guessing from code.

Skip this step only if:

- The user already told you the goal in this conversation
- The change is trivially self-describing (e.g. a single typo fix, a single test rename)

When asking, keep it tight:

> "Before I commit — give me a one-line description of what these changes do and why. If multiple things are in flight, list them separately so I can split commits."

## Allowed types

| Type       | Use for                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `feat`     | New user-visible functionality                                                                              |
| `fix`      | Bug fix                                                                                                     |
| `refactor` | Code change with no behavior change                                                                         |
| `test`     | Adding or rewriting tests, no production code changes                                                       |
| `docs`     | Documentation only (DOCS.md, README, comments)                                                              |
| `perf`     | Performance improvement, no behavior change                                                                 |
| `style`    | Formatting only (prettier, oxlint --fix). **Not** "look-and-feel UI tweaks\*\* — those are `feat` or `fix`. |
| `build`    | Build system, native compile, package scripts                                                               |
| `chore`    | Tooling, config, dependencies, repo housekeeping                                                            |
| `ci`       | CI workflows                                                                                                |

If a change touches multiple types, split it. A `feat` that also fixes an unrelated bug is two commits.

## Subject line rules

- **≤ 72 characters total**, including the `<type>: ` prefix. Aim for 50.
- **Lowercase after the colon.** `feat: add ...`, not `feat: Add ...`.
- **Imperative mood.** "add reactive glyph signal", not "added" / "adds".
- **No trailing period.**
- **No file paths or symbol names** unless they're load-bearing for understanding (`fix: GlyphView interpolation on composite scrub` is fine; `fix: update GlyphView.ts line 142` is not).
- **No emoji.** No "🤖 Generated with Claude Code" footer unless the user explicitly asks.

## Body rules

Most commits don't need a body. Add one when:

- The "why" isn't obvious from the subject (constraint, prior incident, non-local consequence).
- You need to call out a follow-up, a known limitation, or a behavioral subtlety.

When you write a body:

- Blank line after the subject.
- Wrap at ~72 chars.
- Bullets are fine. Walls of prose are not.
- Don't restate the diff. Explain what the diff doesn't say.

## Splitting commits

Before staging, look at what's modified and ask: **does this collapse to one logical change, or several?**

Strong signals to split:

- Unrelated subsystems touched (e.g. text layout AND clipboard).
- A file rename / directory reorg mixed with logic edits in those files. → reorg first, edits second.
- Test-only changes that are independent of the feature (e.g. migrating an old test to TestEditor while also adding a new feature). → split.
- Generated code regenerated alongside hand-edits. → split (`chore: regenerate types` separate from the `feat`).
- A formatting sweep landed on top of real changes. → `style:` separate.
- Docs refresh alongside code. → fine to bundle if the docs describe the code in the same commit; split if the docs are a broader refresh.

Signals to **keep together**:

- Production code + the tests that cover it.
- A type change + the call sites it forces.
- A rename + the imports that follow from it.

When in doubt: propose the split to the user and let them confirm before you stage anything. A wrong split is annoying to unwind.

### How to propose a split

After the user describes the changes, send a short plan like:

> Proposed commits:
>
> 1. `refactor: move text/* under lib/text` — pure file moves, no logic changes
> 2. `feat: <thing the user described>` — Editor.ts, NativeBridge.ts, App.tsx
> 3. `test: cover <thing>` — new Editor.test.ts and updated suites
> 4. `docs: refresh text/ DOCS.md`
>
> Want me to stage and commit in that order?

Wait for confirmation before running `git add` / `git commit`.

## Examples from this repo

**Good** (keep doing these):

- `feat: text-system rewrite — bottom-up rebuild around Cell + TextRun`
- `fix: canvas interpolates composite components on slider scrub`
- `test: GlyphView interpolation against MutatorSans`
- `refactor: sweep leaky naming suffixes`

**Bad** (don't do these):

- `add variation cache to the editor, fix bug where edit sessions did not have current variation when opening a new glyph for editing`
  → no prefix, two unrelated changes, runs to ~120 chars. Should have been:
  - `feat: cache variation state on Editor`
  - `fix: hydrate edit session with current variation on glyph open`
- `style fixes`
  → vague. What style? Where? Use `style: prettier sweep across renderer/` or just merge into the parent commit.
- `component restructure`
  → no prefix, says nothing. `refactor: split <X> into <Y> + <Z>`.
- `more home sidebar design`
  → "more" is a smell that says "I didn't bother to describe this". Squash into the parent or rename to `feat: home sidebar — <specific addition>`.

## Process

1. **Ask the user for a one-line description** (Step 0) unless already covered.
2. Run `git status` and `git diff` (and `git diff --cached` if anything is already staged) in parallel. Read enough of the diff to know what changed — don't trust the file list alone.
3. Look at recent `git log --oneline -10` to match style and prefix conventions.
4. **Decide: one commit or several?** Apply the splitting rules above. If splitting, propose the plan to the user and wait for confirmation.
5. Stage explicitly with `git add <paths>` — never `git add -A` or `git add .`. Per-commit staging keeps splits clean.
6. Commit each unit with `git commit -m "$(cat <<'EOF' ... EOF)"` (heredoc, so multi-line bodies survive shell quoting).
7. Run `git status` after each commit to confirm what's left.

## Hard rules

- **Never** `git commit` until the user has explicitly asked for a commit, or has confirmed the proposed split.
- **Never** skip hooks (`--no-verify`, `--no-gpg-sign`) unless the user explicitly asks. If a pre-commit hook fails, fix the issue and create a NEW commit — do not `--amend`.
- **Never** commit files that look like secrets (`.env`, `credentials.json`, anything with API keys in the diff). Flag them and ask.
- **Never** stage with `-A` / `.` — pick paths.
- **Never** push as part of a commit task unless the user asks.
- **Never** add Claude Code attribution / co-author trailers unless the user asks.
