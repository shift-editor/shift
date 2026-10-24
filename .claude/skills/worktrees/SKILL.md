---
name: worktrees
description: Create, track, and clean up Shift git worktrees and their build output. Use when creating a worktree, when finishing with one (its PR merged, a spike or comparison run ended, an agent's isolated task is done), before release or E2E builds, and whenever the disk is low or a command fails with ENOSPC.
---

# /worktrees — Worktrees that clean up after themselves

Every Shift worktree builds its own Rust `target/` (2–35 GB, more with release and E2E builds) and `node_modules/` (about 1 GB). Forty forgotten worktrees filled a 229 GB disk mid-task. Once the disk is full, no tool can run, not even the command to free it, so the person has to clean up from a separate terminal.

## The rule

**Whoever creates a worktree removes it, or its build output, when the work it was for is done.** A worktree that holds work in progress keeps its sources; its build output is always disposable.

## Before creating one

- Check space: `df -h /`. Below 30 GB, clean up first; a release build plus E2E can take 20 GB.
- Put throwaway checkouts (comparing against `main`, reproducing a failure) in the session scratchpad, and remove them in the same task.
- For a throwaway checkout that only builds Rust, share an existing target directory instead of making a new one: `CARGO_TARGET_DIR=<an existing worktree>/target cargo test …`.
- Don't run `pnpm install` in a worktree that only needs Rust.

## When the work is done

| Situation | Do |
|---|---|
| Throwaway checkout you created (comparison, reproduction) | `git worktree remove --force <path>` once its results are recorded |
| Branch whose PR merged | Remove the worktree; delete the local branch only if the person agrees |
| Worktree kept for later work | Delete `target/` and `node_modules/` |
| Release or E2E builds you ran | Delete `target/release` and `apps/desktop/out` when the measurements are recorded |

## Finding what to clean

Run the report from the repository root; it is read-only:

```sh
.agents/skills/worktrees/report.sh        # every worktree: dirty files, unpushed commits, target and node_modules size
.agents/skills/worktrees/report.sh --prs  # also each branch's pull request state
```

- **DIRTY** is the number of uncommitted files and **UNPUSHED** the number of commits no remote branch has. Either one non-zero means removing the worktree loses work.
- **gone** means the directory no longer exists; `git worktree prune` drops the entry.

## What is safe

- **Always safe, no need to ask:** deleting `target/`, `node_modules/`, `apps/desktop/out`, or Playwright output in any worktree, and `git worktree prune`. They are rebuilt on demand.
- **Safe for worktrees you created in this task:** `git worktree remove` once nothing in it is dirty or unpushed.
- **Ask first:** removing any other worktree, any worktree with dirty files or unpushed commits, the main checkout's `target/`, or deleting a branch. List what would be lost.
- **Never:** `git worktree remove --force` or `rm -rf` on a worktree with dirty files or unpushed commits without the person's go-ahead.

## When the disk is already full

Tools can't start, because each one writes its output to disk first. Give the person commands to run in a terminal outside the agent, starting with the largest disposable output:

```sh
du -sh ~/worktrees/*/target ~/repos/shift/.claude/worktrees/*/target 2>/dev/null | sort -h | tail
rm -rf <worktree>/target
df -h /
```

## Checklist

- [ ] `df -h /` checked before release or E2E builds.
- [ ] Every worktree created in this task is removed, or its build output deleted, before the task ends.
- [ ] Nothing dirty or unpushed was removed without the person's go-ahead.
