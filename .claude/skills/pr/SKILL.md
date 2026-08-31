---
name: pr
description: Canonical rules for preparing, opening, and updating Shift pull requests. Use whenever the user asks to create, open, draft, update, or review a pull request. Enforces issue discovery and linkage, Conventional Commit titles, release-note quality, complete validation evidence, and safe pushing.
---

# /pr — How Shift pull requests are written

A pull request is one reviewable product or engineering change. Its title must make sense in history and as potential Release Please input.

## Title syntax

Every pull request title uses Conventional Commits:

```text
<type>[optional scope][optional !]: <concise imperative description>
```

Use the same types and subject rules as `/commit`. Examples:

```text
feat: add source conversion preview
fix(document): preserve the last valid save
ci: publish signed Alpha artifacts
```

The title must:

- be at most 72 characters;
- use lowercase imperative wording after the colon;
- describe the user or system outcome, not the list of files changed;
- omit trailing punctuation, emoji, agent labels, and `[codex]` prefixes.

CI rejects titles that are not Conventional Commits. GitHub may also use the pull request title as a squash commit subject, so treat it as release-quality history.

## Release Please behavior

Release Please reads conventional commits merged to `main` and maintains a draft release pull request.

- `feat`, `fix`, and `perf` become public changelog entries.
- `refactor`, `test`, `docs`, `build`, `ci`, `style`, and `chore` remain valid but are hidden from public release notes.
- Ordinary pull requests must not bump the product version or edit generated changelog sections.
- Maturity and milestone changes require explicit user approval and a `Release-As:` footer.
- The generated `chore: release Shift …` pull request is special: review its version, changelog, warning text, and artifact readiness before merging it.

## Pull request body

Use a concise body with evidence:

```markdown
## Summary

- what changed and why
- important behavioral or architectural boundary

## Issue

Closes #123

## Testing

- `exact command`
- focused manual verification
```

Add `## Risks` or `## Follow-up` only when they materially help review. Do not add empty sections, generic claims such as “tests pass,” generated marketing prose, or agent attribution.

Testing entries must distinguish:

- commands that passed;
- checks that failed and why;
- checks not run;
- focused manual verification where an automated test would be low value.

For release changes, state whether packaging was smoke-tested and which hosted platform/signing checks remain.

### UI review evidence

For materially visible UI changes, attach screenshots or recordings before marking the pull request ready for review.

- Cover every distinct state needed to review the change, including native dialogs and fallback, error, empty, loading, or disabled states when affected.
- Capture the actual implementation. Include before-and-after evidence when the change intentionally modifies existing appearance or interaction.
- Prefer GitHub user attachments over committing review-only media to the repository.
- Redact private user data, credentials, and sensitive documents before uploading.
- If useful evidence cannot be captured safely or reliably, state why in the pull request rather than silently omitting it.

Do not add ceremonial screenshots for changes with no visible review surface.

### Desktop E2E impact

For changes that can affect desktop user flows or rendering, complete the E2E impact check in `apps/desktop/e2e/README.md` before opening or updating the pull request.

- Search existing specs by affected surface, command, or workflow even when the branch does not change E2E files.
- Run the smallest relevant Playwright project, file, and title filter. Run the complete affected project for broad or shared-fixture changes.
- Update visual snapshots only for intentional appearance changes, inspect every changed image, and rerun without update mode.
- List exact E2E commands in `## Testing`; explicitly identify relevant E2E coverage not run and why.

### Issue linkage

Every ordinary pull request includes `## Issue`. Search open and recently closed issues before opening or updating the pull request, and reference every issue materially addressed by the change.

- Use `Closes #123` only when the pull request fully satisfies that issue's acceptance criteria. Merging to the default branch then closes the issue.
- Use `Refs #123` for partial work, prerequisites, investigation, or related context. The issue remains open.
- If substantial feature, bug, regression, or roadmap work has no adequate issue, invoke `/issue` and create one before opening the pull request.
- For small maintenance, documentation, dependency, or mechanical work with no issue, write `No issue — <brief reason>` rather than creating a ceremonial issue.
- Generated Release Please and dependency-bot pull requests are exempt from the issue section.

Never use a closing keyword merely because an issue is related. If any accepted outcome remains, use `Refs`.

## Preparation process

1. Read `git status`, staged and unstaged diffs, the branch commits, and the complete diff against `main`.
2. Confirm the branch contains only the requested change. Do not absorb unrelated dirty files.
3. Search open and recently closed issues; decide whether the pull request closes, references, or does not require an issue.
4. For substantial untracked work, invoke `/issue` before opening the pull request.
5. Use `/commit` to create any required logical commits.
6. Rebase or merge the current `main` only when needed. Do not rewrite a published branch without explicit approval.
7. Run focused validation and the repository checks required by the affected subsystem.
8. Re-read the final diff and summarize observable behavior, not implementation trivia.
9. Choose a Conventional Commit title that matches the dominant change.
10. Push the named branch without force unless explicitly approved.
11. Create the pull request with an explicit base and head, preferably using a body file to preserve formatting.
12. Verify the rendered issue keyword and all body formatting on GitHub.
13. Return the pull request URL, title, issue relationship, commit list, and validation status.

A request to create or update a pull request authorizes the ordinary push needed for that request. It never authorizes force-pushing, changing repository settings, merging the pull request, or publishing a release.

## Review process

When reviewing a pull request:

- inspect the diff and tests rather than trusting the body;
- verify the title matches Conventional Commits and the actual dominant change;
- identify user-visible `feat`, `fix`, and `perf` wording that would be confusing in release notes;
- verify the issue section exists, every linked issue is relevant, and `Closes` is used only for complete resolution;
- check that version and generated changelog edits appear only in a Release Please pull request;
- distinguish blocking correctness issues from optional improvements;
- verify claims against repository behavior and report exact paths and lines.

## Hard rules

- Never open an ordinary pull request without searching for relevant issues and including an issue section.
- Never open a pull request from a branch with uncommitted intended changes.
- Never include credentials, signing material, `.env` files, or tokens.
- Pull request titles, bodies, comments, commits, and release-note wording must describe the change and its validation, not the process used to produce it. Never include incidental execution metadata such as agent identity, handoff mechanics, remote hosts, machine names, tmux sessions, worktree paths, or “finishing work off.” Mention such infrastructure only when it is itself the subject of the change. Platform names are allowed only when materially relevant to behavior or testing evidence.
- Never force-push, merge, enable auto-merge, or publish a release unless the user explicitly asks.
- Never fabricate issue links, test results, screenshots, reviewers, or release-note claims.
- Never hide a failed or skipped check from the pull request body.
