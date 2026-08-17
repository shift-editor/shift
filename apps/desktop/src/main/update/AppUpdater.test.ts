import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AppLifecycle } from "../app/AppLifecycle";
import type { ShiftLogger } from "../logging";
import { AppUpdater } from "./AppUpdater";
import type { AppUpdaterOptions } from "./types";

vi.mock("./updateDialogs", () => ({
  showUpdateCurrent: async () => undefined,
  showUpdateDownloading: async () => undefined,
  showUpdateFailure: async () => false,
  showUpdateReady: async () => false,
  showUpdateUnavailable: async () => false,
}));

class FakeAutoUpdater extends EventEmitter {
  feedUrl: string | null = null;
  checkCount = 0;

  setFeedURL(options: { url: string }): void {
    this.feedUrl = options.url;
  }

  checkForUpdates(): void {
    this.checkCount += 1;
  }

  quitAndInstall(): void {}
}

function createUpdater(overrides: Partial<AppUpdaterOptions> = {}) {
  const autoUpdater = new FakeAutoUpdater();
  const lifecycleState = { guardsEnabled: true };
  const lifecycle = {
    confirmQuit: async () => {
      lifecycleState.guardsEnabled = false;
      return true;
    },
    resetQuitConfirmation: () => {
      lifecycleState.guardsEnabled = true;
      return true;
    },
  } as unknown as AppLifecycle;
  const log = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as ShiftLogger;
  const options: AppUpdaterOptions = {
    autoUpdater: autoUpdater as unknown as AppUpdaterOptions["autoUpdater"],
    lifecycle,
    activeWindow: () => null,
    applicationName: () => "Shift",
    openExternal: async () => undefined,
    isPackaged: true,
    platform: "darwin",
    architecture: "arm64",
    productVersion: "0.1.0-alpha.1",
    distribution: "release",
    feedBaseUrl: "https://shift-editor.github.io/shift/updates",
    log,
    ...overrides,
  };
  return { updater: new AppUpdater(options), autoUpdater, lifecycleState };
}

async function downloadUpdate(updater: AppUpdater, autoUpdater: FakeAutoUpdater) {
  updater.start();
  await updater.checkForUpdates("automatic");
  autoUpdater.emit("update-available");
  autoUpdater.emit(
    "update-downloaded",
    {},
    "",
    "0.1.0-alpha.2",
    new Date("2026-08-16T12:00:00.000Z"),
    "https://github.com/shift-editor/shift/releases",
  );
  await vi.waitFor(() => expect(updater.state.type).toBe("ready"));
}

describe("AppUpdater", () => {
  it("restores document guards after an asynchronous install failure", async () => {
    const { updater, autoUpdater, lifecycleState } = createUpdater();
    await downloadUpdate(updater, autoUpdater);
    await updater.restartToUpdate();
    expect(lifecycleState.guardsEnabled).toBe(false);

    autoUpdater.emit("error", new Error("ShipIt failed"));
    await vi.waitFor(() => expect(updater.state.type).toBe("ready"));
    expect(lifecycleState.guardsEnabled).toBe(true);
  });

  it("uses the native Windows x64 Squirrel feed", async () => {
    const { updater, autoUpdater } = createUpdater({ platform: "win32", architecture: "x64" });
    updater.start();

    await updater.checkForUpdates("manual");

    expect(updater.state.type).toBe("checking");
    expect(autoUpdater.checkCount).toBe(1);
    expect(autoUpdater.feedUrl).toBe(
      "https://shift-editor.github.io/shift/updates/release/win32/x64",
    );
  });
});
