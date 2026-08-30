---
name: shift-remote-e2e
description: Runs Shift Playwright/Electron E2E tests through a serialized queue on an SSH-accessible macOS runner so application windows do not interrupt the local desktop. Use whenever E2E verification, visual snapshots, GPU tests, or Playwright performance tests are needed in Shift.
compatibility: Requires an SSH host with an active macOS GUI login, Nix, and a Shift checkout.
---

# Shift Remote E2E

Run Shift's Playwright/Electron tests on the configured remote Mac instead of opening Electron on the user's current desktop.

## Runner

From the Shift repository, invoke:

```bash
.agents/skills/shift-remote-e2e/scripts/run.py visual e2e/landing.spec.ts
.agents/skills/shift-remote-e2e/scripts/run.py visual e2e/document-recovery.spec.ts --grep "Save As"
.agents/skills/shift-remote-e2e/scripts/run.py gpu e2e/glyph-grid.spec.ts --grep "source switching"
.agents/skills/shift-remote-e2e/scripts/run.py perf e2e/glyph-grid-perf.spec.ts
```

Choose the smallest relevant project, file, and title filter. Follow `apps/desktop/e2e/README.md` for project selection and impact checks.

## Queue behavior

The runner uses the Pueue package from Nixpkgs and maintains a `shift-e2e` group with parallelism `1`. Competing requests queue in submission order. Pueue owns process execution, persisted task state, and logs, so a task continues if its submitting SSH session disconnects.

The runner:

1. Captures local HEAD, tracked modifications, and untracked non-ignored files.
2. Rejects dirty submodules rather than silently testing incomplete source.
3. Uploads each source overlay into an isolated run directory.
4. Applies queued overlays to a dedicated cached clone without touching the runner's normal Shift checkout.
5. Runs in the Nix dev shell under `caffeinate` with CI snapshot behavior.
6. Streams Pueue output and returns Playwright artifacts under the local temporary directory printed at startup.
7. Resets the cached clone after every completed task and removes collected run directories.
8. Retains dependency and build caches (`node_modules`, Nix, pnpm, Cargo, Turbo, and Vite) to keep later runs fast.

When the local wait is interrupted, do not resubmit the same test automatically. The Pueue task continues remotely and keeps its log and artifacts. Uncollected run directories expire after 24 hours.

## Results

Always report:

- The exact project, file, and title filter.
- Pass or failure status.
- The local result directory printed by the runner.
- Relevant diagnostics from `run.log`, traces, screenshots, or diffs when a test fails.

After a failure, inspect the returned artifacts locally and continue debugging in the local working tree. Do not edit source on the remote runner.

## Configuration

The default SSH alias is `mini`, and the default remote checkout is `~/repos/shift`. Override either without editing the skill:

```bash
SHIFT_E2E_REMOTE_HOST=mac-runner \
SHIFT_E2E_REMOTE_REPO=/path/to/shift \
.agents/skills/shift-remote-e2e/scripts/run.py visual e2e/landing.spec.ts
```
