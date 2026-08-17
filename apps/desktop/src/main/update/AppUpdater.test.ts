import { generateKeyPairSync, sign } from "node:crypto";
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

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const payload = {
  schemaVersion: 1,
  distribution: "release",
  version: "0.1.0-alpha.2",
  publishedAt: "2026-08-16T12:00:00.000Z",
  releaseUrl: "https://github.com/shift-editor/shift/releases/tag/v0.1.0-alpha.2",
  artifacts: [
    {
      platform: "darwin",
      architecture: "arm64",
      feedUrl:
        "https://shift-editor.github.io/shift/updates/release/0.1.0-alpha.2/darwin/arm64/RELEASES.json",
      url: "https://github.com/shift-editor/shift/releases/download/v0.1.0-alpha.2/Shift.zip",
      sha256: "a".repeat(64),
    },
  ],
} as const;

class FakeAutoUpdater extends EventEmitter {
  setFeedURL(): void {}
  checkForUpdates(): void {}
  quitAndInstall(): void {}
}

function responseFor(url: string): Response {
  if (url.endsWith("channel.json")) {
    const bytes = Buffer.from(JSON.stringify(payload));
    return Response.json({
      payload: bytes.toString("base64"),
      signature: sign(null, bytes, privateKey).toString("base64"),
    });
  }

  return Response.json({
    url: payload.artifacts[0].url,
    name: payload.version,
    notes: "",
    pub_date: payload.publishedAt,
    sha256: payload.artifacts[0].sha256,
    size: 1024,
  });
}

function createUpdater() {
  const autoUpdater = new FakeAutoUpdater();
  const lifecycleState = { guardsEnabled: true };
  const lifecycle = {
    confirmQuit: async () => {
      lifecycleState.guardsEnabled = false;
      return true;
    },
    resetQuitConfirmation: () => {
      lifecycleState.guardsEnabled = true;
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
    fetch: async (input) => responseFor(input.toString()),
    isPackaged: true,
    platform: "darwin",
    architecture: "arm64",
    productVersion: "0.1.0-alpha.1",
    distribution: "release",
    feedBaseUrl: "https://shift-editor.github.io/shift/updates",
    publicKey: publicKeyBase64,
    windowsUpdatesEnabled: false,
    log,
  };
  return { updater: new AppUpdater(options), autoUpdater, lifecycleState };
}

async function downloadUpdate(updater: AppUpdater, autoUpdater: FakeAutoUpdater) {
  updater.start();
  await updater.checkForUpdates("automatic");
  autoUpdater.emit("update-available");
  autoUpdater.emit("update-downloaded");
  await vi.waitFor(() => expect(updater.state.type).toBe("ready"));
}

describe("AppUpdater restart safety", () => {
  it("restores document guards after an asynchronous install failure", async () => {
    const { updater, autoUpdater, lifecycleState } = createUpdater();
    await downloadUpdate(updater, autoUpdater);
    await updater.restartToUpdate();
    expect(lifecycleState.guardsEnabled).toBe(false);

    autoUpdater.emit("error", new Error("ShipIt failed"));
    await vi.waitFor(() => expect(updater.state.type).toBe("ready"));
    expect(lifecycleState.guardsEnabled).toBe(true);
  });
});
