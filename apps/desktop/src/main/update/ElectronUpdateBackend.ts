import electronUpdater from "electron-updater";
import type { ShiftLogger } from "../logging";
import type { UpdateBackend, UpdateBackendEvents, UpdateFeed } from "./types";

const { autoUpdater } = electronUpdater;

/** Finds, downloads and installs updates from the build's electron-updater feed. */
export class ElectronUpdateBackend implements UpdateBackend {
  readonly #feed: UpdateFeed;

  /**
   * @param feed - the feed for this build's distribution, platform and architecture.
   * @param log - receives electron-updater's own log.
   */
  constructor(feed: UpdateFeed, log: ShiftLogger) {
    this.#feed = feed;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = log;
  }

  listen(events: UpdateBackendEvents): void {
    autoUpdater.on("update-available", (info) => events.available(info.version));
    autoUpdater.on("update-not-available", () => events.notAvailable());
    autoUpdater.on("download-progress", (progress) => events.progress(progress.percent));
    autoUpdater.on("update-downloaded", () => events.downloaded());
    autoUpdater.on("error", (error) => events.error(error));
  }

  async check(): Promise<void> {
    autoUpdater.setFeedURL(this.#feed);
    await autoUpdater.checkForUpdates();
  }

  async download(): Promise<void> {
    await autoUpdater.downloadUpdate();
  }

  install(): void {
    autoUpdater.quitAndInstall(false, true);
  }
}
