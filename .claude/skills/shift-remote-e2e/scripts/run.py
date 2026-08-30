#!/usr/bin/env python3
"""Run Shift Playwright E2E through a serialized Pueue queue on a remote Mac."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

PROJECT_COMMANDS = {
    "visual": "test:e2e:visual",
    "gpu": "test:e2e:gpu",
    "perf": "test:e2e:perf",
}
PUEUE_GROUP = "shift-e2e"


def run(
    command: list[str],
    *,
    cwd: Path | None = None,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def git(root: Path, *args: str) -> str:
    result = run(["git", *args], cwd=root, capture=True)
    return result.stdout.strip()


def remote_quote(value: str) -> str:
    return shlex.quote(value)


def ssh(host: str, command: str, *, capture: bool = False, check: bool = True):
    return run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command],
        capture=capture,
        check=check,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run Shift E2E remotely without opening Electron on the local desktop.",
    )
    parser.add_argument("project", choices=PROJECT_COMMANDS)
    parser.add_argument("playwright_args", nargs=argparse.REMAINDER)
    return parser.parse_args()


def repository_root() -> Path:
    result = run(["git", "rev-parse", "--show-toplevel"], capture=True)
    root = Path(result.stdout.strip()).resolve()
    if not (root / "apps/desktop/playwright.config.ts").is_file():
        raise RuntimeError(f"Not a Shift checkout: {root}")
    return root


def reject_dirty_submodules(root: Path) -> None:
    result = run(
        [
            "git",
            "submodule",
            "foreach",
            "--recursive",
            "--quiet",
            "status=$(git status --porcelain); if [ -n \"$status\" ]; then echo \"$name\"; fi",
        ],
        cwd=root,
        capture=True,
    )
    dirty = [line for line in result.stdout.splitlines() if line.strip()]
    if dirty:
        raise RuntimeError(
            "Remote E2E does not yet transport dirty submodules: " + ", ".join(dirty),
        )


def create_overlay(root: Path, staging: Path) -> tuple[Path, Path]:
    patch = staging / "working-tree.patch"
    patch.write_bytes(
        subprocess.check_output(["git", "diff", "--binary", "HEAD", "--"], cwd=root),
    )

    output = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=root,
    )
    untracked = [entry for entry in output.decode().split("\0") if entry]
    archive = staging / "untracked.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for relative in untracked:
            tar.add(root / relative, arcname=relative, recursive=True)

    return patch, archive


def ensure_pueue(host: str, remote_cache: str) -> str:
    pueue_root = ssh(
        host,
        "nix build --no-link --print-out-paths nixpkgs#pueue",
        capture=True,
    ).stdout.strip().splitlines()[-1]
    pueue = f"{pueue_root}/bin/pueue"
    pueued = f"{pueue_root}/bin/pueued"
    daemon_log = f"{remote_cache}/pueued.log"
    command = f"""
set -euo pipefail
mkdir -p {remote_quote(remote_cache)}/runs
if ! {remote_quote(pueue)} status --json >/dev/null 2>&1; then
  nohup {remote_quote(pueued)} -d </dev/null >{remote_quote(daemon_log)} 2>&1 &
  for attempt in 1 2 3 4 5; do
    {remote_quote(pueue)} status --json >/dev/null 2>&1 && break
    sleep 1
  done
fi
{remote_quote(pueue)} status --json >/dev/null
{remote_quote(pueue)} group add {remote_quote(PUEUE_GROUP)} >/dev/null 2>&1 || true
{remote_quote(pueue)} parallel -g {remote_quote(PUEUE_GROUP)} 1 >/dev/null
find {remote_quote(remote_cache + '/runs')} -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {{}} +
"""
    ssh(host, command)
    return pueue


def create_job_script(
    *,
    remote_cache: str,
    remote_repo: str,
    remote_run: str,
    head: str,
    project: str,
    playwright_args: list[str],
    has_bundle: bool,
) -> str:
    remote_runner = f"{remote_cache}/runner"
    package_command = PROJECT_COMMANDS[project]
    test_args = " ".join(remote_quote(argument) for argument in playwright_args)
    bundle_fetch = ""
    if has_bundle:
        bundle_fetch = (
            f"git -C {remote_quote(remote_runner)} fetch "
            f"{remote_quote(remote_run + '/head.bundle')} HEAD\n"
        )

    return f"""#!/bin/bash
set -euo pipefail
runner={remote_quote(remote_runner)}
run_dir={remote_quote(remote_run)}
result_path="$run_dir/result.json"

cleanup() {{
  exit_code=$?
  trap - EXIT
  set +e

  existing=()
  for path in \
    apps/desktop/e2e/test-results \
    apps/desktop/e2e/perf-results \
    apps/desktop/playwright-report; do
    [ ! -e "$runner/$path" ] || existing+=("$path")
  done
  if [ ${{#existing[@]}} -gt 0 ]; then
    tar -czf "$run_dir/artifacts.tar.gz" -C "$runner" "${{existing[@]}}"
  fi

  printf '{{"exit_code":%s}}\n' "$exit_code" > "$result_path"
  git -C "$runner" reset --hard >/dev/null 2>&1
  git -C "$runner" clean -fd >/dev/null 2>&1
  git -C "$runner" submodule foreach --recursive --quiet \
    'git reset --hard >/dev/null 2>&1; git clean -fd >/dev/null 2>&1' >/dev/null 2>&1
  rm -rf "$runner/apps/desktop/e2e/test-results"
  rm -rf "$runner/apps/desktop/e2e/perf-results"
  rm -rf "$runner/apps/desktop/playwright-report"
  exit "$exit_code"
}}
trap cleanup EXIT

if [ ! -d "$runner/.git" ]; then
  origin_url=$(git -C {remote_quote(remote_repo)} remote get-url origin)
  git clone --local --recurse-submodules {remote_quote(remote_repo)} "$runner"
  git -C "$runner" remote set-url origin "$origin_url"
fi

git -C "$runner" reset --hard
git -C "$runner" clean -fd
git -C "$runner" fetch origin --prune
{bundle_fetch}git -C "$runner" checkout --detach {remote_quote(head)}
git -C "$runner" submodule update --init --recursive --force
if [ -s "$run_dir/working-tree.patch" ]; then
  git -C "$runner" apply --binary "$run_dir/working-tree.patch"
fi
tar -xzf "$run_dir/untracked.tar.gz" -C "$runner"
rm -rf "$runner/apps/desktop/e2e/test-results"
rm -rf "$runner/apps/desktop/e2e/perf-results"
rm -rf "$runner/apps/desktop/playwright-report"

cd "$runner"
export CI=1
caffeinate -dimsu nix develop --command bash -lc \
  {remote_quote(f'set -o pipefail; pnpm install --frozen-lockfile --prefer-offline; pnpm {package_command} {test_args}')}
"""


def task_status(host: str, pueue: str, task_id: int) -> tuple[str, dict]:
    result = ssh(host, f"{remote_quote(pueue)} status --json", capture=True)
    state = json.loads(result.stdout)
    task = state["tasks"].get(str(task_id))
    if task is None:
        raise RuntimeError(f"Pueue task {task_id} disappeared")
    status = task["status"]
    if "Queued" in status:
        return "queued", task
    if "Running" in status:
        return "running", task
    if "Done" in status:
        return "done", task
    return next(iter(status)).lower(), task


def wait_until_running(host: str, pueue: str, task_id: int) -> str:
    announced = False
    while True:
        status, _task = task_status(host, pueue, task_id)
        if status != "queued":
            return status
        if not announced:
            print(f"Task {task_id} queued behind existing remote E2E work.", flush=True)
            announced = True
        time.sleep(2)


def stream_task(host: str, pueue: str, task_id: int, log_path: Path) -> None:
    command = f"{remote_quote(pueue)} follow {task_id}"
    process = subprocess.Popen(
        ["ssh", "-o", "BatchMode=yes", host, command],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    interrupted = False

    def forward_signal(signum: int, _frame) -> None:
        nonlocal interrupted
        interrupted = True
        if process.poll() is None:
            process.terminate()

    previous_int = signal.signal(signal.SIGINT, forward_signal)
    previous_term = signal.signal(signal.SIGTERM, forward_signal)
    try:
        with log_path.open("w") as log:
            assert process.stdout is not None
            for line in process.stdout:
                sys.stdout.write(line)
                sys.stdout.flush()
                log.write(line)
                log.flush()
        process.wait()
    finally:
        signal.signal(signal.SIGINT, previous_int)
        signal.signal(signal.SIGTERM, previous_term)

    if interrupted:
        raise KeyboardInterrupt


def save_finished_log(host: str, pueue: str, task_id: int, log_path: Path) -> None:
    result = ssh(
        host,
        f"{remote_quote(pueue)} log --json --full {task_id}",
        capture=True,
    )
    task_log = json.loads(result.stdout)[str(task_id)]["output"]
    log_path.write_text(task_log)
    if task_log:
        print(task_log, end="" if task_log.endswith("\n") else "\n")


def download_results(host: str, remote_run: str, destination: Path) -> int:
    result = ssh(
        host,
        f"cat {remote_quote(remote_run + '/result.json')}",
        capture=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Remote E2E task finished without a result record")
    exit_code = int(json.loads(result.stdout)["exit_code"])

    remote_archive = f"{remote_run}/artifacts.tar.gz"
    exists = ssh(host, f"test -f {remote_quote(remote_archive)}", check=False)
    if exists.returncode == 0:
        local_archive = destination / "artifacts.tar.gz"
        run(["scp", "-q", f"{host}:{remote_archive}", str(local_archive)])
        with tarfile.open(local_archive, "r:gz") as tar:
            tar.extractall(destination, filter="data")
        local_archive.unlink()

    return exit_code


def main() -> int:
    args = parse_args()
    root = repository_root()
    reject_dirty_submodules(root)

    host = os.environ.get("SHIFT_E2E_REMOTE_HOST", "mini")
    remote_repo_setting = os.environ.get("SHIFT_E2E_REMOTE_REPO", "repos/shift")
    run_id = f"{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"
    local_results = Path(tempfile.gettempdir()) / "shift-remote-e2e" / run_id
    local_results.mkdir(parents=True)
    local_staging = Path(tempfile.mkdtemp(prefix="shift-remote-e2e-stage-"))
    remote_run: str | None = None
    submitted = False
    collected = False

    try:
        remote_home = ssh(host, 'printf "%s" "$HOME"', capture=True).stdout
        remote_repo = (
            remote_repo_setting
            if remote_repo_setting.startswith("/")
            else f"{remote_home}/{remote_repo_setting}"
        )
        remote_cache = f"{remote_home}/Library/Caches/shift-remote-e2e"
        remote_runner = f"{remote_cache}/runner"
        remote_run = f"{remote_cache}/runs/{run_id}"
        pueue = ensure_pueue(host, remote_cache)
        head = git(root, "rev-parse", "HEAD")
        patch, untracked_archive = create_overlay(root, local_staging)

        present = ssh(
            host,
            f"test -d {remote_quote(remote_runner + '/.git')} && "
            f"git -C {remote_quote(remote_runner)} cat-file -e {remote_quote(head)}^{{commit}}",
            check=False,
        ).returncode == 0
        bundle: Path | None = None
        if not present:
            bundle = local_staging / "head.bundle"
            run(["git", "bundle", "create", str(bundle), "HEAD"], cwd=root)

        ssh(host, f"mkdir -p {remote_quote(remote_run)}")
        upload = [str(patch), str(untracked_archive)]
        if bundle is not None:
            upload.append(str(bundle))
        run(["scp", "-q", *upload, f"{host}:{remote_run}/"])

        job = local_staging / "job.sh"
        job.write_text(
            create_job_script(
                remote_cache=remote_cache,
                remote_repo=remote_repo,
                remote_run=remote_run,
                head=head,
                project=args.project,
                playwright_args=args.playwright_args,
                has_bundle=bundle is not None,
            ),
        )
        run(["scp", "-q", str(job), f"{host}:{remote_run}/job.sh"])

        add_command = (
            f"{remote_quote(pueue)} add -g {remote_quote(PUEUE_GROUP)} "
            f"--label {remote_quote('shift-e2e:' + run_id)} --print-task-id -- "
            f"/bin/bash {remote_quote(remote_run + '/job.sh')}"
        )
        task_id = int(ssh(host, add_command, capture=True).stdout.strip())
        submitted = True

        print(f"Remote E2E run: {run_id}")
        print(f"Pueue task: {task_id}")
        print(f"Project: {args.project}")
        print(f"Results: {local_results}", flush=True)

        initial_status = wait_until_running(host, pueue, task_id)
        log_path = local_results / "run.log"
        if initial_status == "running":
            stream_task(host, pueue, task_id, log_path)
        else:
            save_finished_log(host, pueue, task_id, log_path)

        while task_status(host, pueue, task_id)[0] != "done":
            time.sleep(1)

        exit_code = download_results(host, remote_run, local_results)
        collected = True
        if exit_code == 0:
            print(f"Remote E2E passed. Log: {log_path}")
        else:
            print(f"Remote E2E failed ({exit_code}). Results: {local_results}", file=sys.stderr)
        return exit_code
    except KeyboardInterrupt:
        if submitted:
            print(
                "Local wait interrupted; the queued remote task will continue and retain its results.",
                file=sys.stderr,
            )
        return 130
    finally:
        if remote_run is not None and (collected or not submitted):
            ssh(host, f"rm -rf {remote_quote(remote_run)}", check=False)
        shutil.rmtree(local_staging, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"shift-remote-e2e: {error}", file=sys.stderr)
        raise SystemExit(1)
