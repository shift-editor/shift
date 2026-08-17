import { describe, expect, it } from "vitest";
import { nextUpdateState } from "./nextUpdateState";
import type { Update, UpdateState } from "./types";

const update: Update = {
  distribution: "release",
  version: "0.1.0-alpha.2",
  publishedAt: "2026-08-16T12:00:00.000Z",
  releaseUrl: "https://github.com/shift-editor/shift/releases/tag/v0.1.0-alpha.2",
  artifact: {
    platform: "darwin",
    architecture: "arm64",
    feedUrl:
      "https://shift-editor.github.io/shift/updates/release/0.1.0-alpha.2/darwin/arm64/RELEASES.json",
    url: "https://github.com/shift-editor/shift/releases/download/v0.1.0-alpha.2/Shift.zip",
    sha256: "a".repeat(64),
  },
};

describe("application update transitions", () => {
  it("moves a manual check through download to ready", () => {
    const checking = nextUpdateState(
      { type: "idle" },
      { type: "checkRequested", trigger: "manual" },
    );
    const downloading = nextUpdateState(checking!, { type: "updateAvailable", update });
    const ready = nextUpdateState(downloading!, { type: "updateDownloaded" });

    expect(ready).toEqual({ type: "ready", update });
  });

  it("records a completed no-update check", () => {
    const state: UpdateState = { type: "checking", trigger: "manual" };
    const current = nextUpdateState(state, {
      type: "noUpdateAvailable",
      checkedAt: "2026-08-16T12:30:00.000Z",
    });

    expect(current).toEqual({ type: "current", checkedAt: "2026-08-16T12:30:00.000Z" });
  });

  it("preserves the downloaded update when restart is rejected", () => {
    const restarting = nextUpdateState({ type: "ready", update }, { type: "restartRequested" });
    const ready = nextUpdateState(restarting!, { type: "restartRejected" });

    expect(ready).toEqual({ type: "ready", update });
  });

  it("allows a failed check to be retried", () => {
    const failed: UpdateState = {
      type: "failed",
      phase: "check",
      trigger: "automatic",
      message: "offline",
    };

    expect(nextUpdateState(failed, { type: "checkRequested", trigger: "manual" })).toEqual({
      type: "checking",
      trigger: "manual",
    });
  });

  it("rejects stale events without changing state", () => {
    const state: UpdateState = { type: "ready", update };

    expect(nextUpdateState(state, { type: "updateDownloaded" })).toBeNull();
    expect(nextUpdateState(state, { type: "checkRequested", trigger: "automatic" })).toBeNull();
  });
});
