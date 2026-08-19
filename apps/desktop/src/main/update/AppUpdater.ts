import { app, dialog, shell, type MessageBoxOptions } from "electron";
import electronUpdater from "electron-updater";
import { errorToMessage } from "../../shared/errors";
import { shiftDistribution, shiftProductVersion, shiftUpdateBaseUrl } from "../release";
import { updateFeed } from "./updateFeed";
import type { AppUpdaterOptions, UpdateStatus, UpdateTrigger } from "./types";

const INITIAL_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/shift-editor/shift/releases";
const NIGHTLY_URL = "https://github.com/shift-editor/shift/releases/tag/nightly";
const { autoUpdater } = electronUpdater;

/** Owns native application update checks, dialogs, and restart safety. */
export class AppUpdater {
  readonly #options: AppUpdaterOptions;

  #status: UpdateStatus = { type: "idle" };
  #started = false;
  #readyPrompt: Promise<void> | null = null;
  #relaunching = false;

  constructor(options: AppUpdaterOptions) {
    this.#options = options;
  }

  /** Installs Electron listeners and schedules quiet checks for eligible builds. */
  start(): void {
    if (this.#started || !app.isPackaged || !this.#feed()) return;
    this.#started = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = this.#options.log;
    autoUpdater.on("update-available", () => this.#updateAvailable());
    autoUpdater.on("update-not-available", () => {
      void this.#updateNotAvailable().catch((error) => {
        this.#options.log.error("update-not-available handler failed", error);
      });
    });
    autoUpdater.on("update-downloaded", () => {
      void this.#updateDownloaded().catch((error) => {
        this.#options.log.error("update-downloaded handler failed", error);
      });
    });
    autoUpdater.on("error", (error) => {
      void this.#updateFailed(error).catch((handlerError) => {
        this.#options.log.error("updater error handler failed", handlerError);
      });
    });

    const initialCheck = setTimeout(() => {
      void this.checkForUpdates("automatic").catch((error) => {
        this.#options.log.error("initial update check failed", error);
      });
    }, INITIAL_CHECK_DELAY_MS);
    initialCheck.unref();

    const periodicCheck = setInterval(() => {
      void this.checkForUpdates("automatic").catch((error) => {
        this.#options.log.error("periodic update check failed", error);
      });
    }, CHECK_INTERVAL_MS);
    periodicCheck.unref();
  }

  /** Checks the compiled channel, deduplicating checks, downloads, and restart prompts. */
  async checkForUpdates(trigger: UpdateTrigger): Promise<void> {
    const feed = app.isPackaged ? this.#feed() : null;
    if (!feed) {
      if (trigger === "manual") await this.#showManualDownload();
      return;
    }

    switch (this.#status.type) {
      case "checking":
      case "restarting":
        return;
      case "downloading":
        if (trigger === "manual") await this.#showDownloading();
        return;
      case "ready":
        if (trigger === "manual") await this.#notifyReady();
        return;
      case "idle":
        break;
    }

    this.#status = { type: "checking", trigger };
    this.#options.log.info("checking Electron update feed", {
      distribution: shiftDistribution,
      platform: process.platform,
      architecture: process.arch,
      feedUrl: feed.url,
    });

    try {
      autoUpdater.setFeedURL(feed);
      void autoUpdater.checkForUpdates().catch((error) => {
        void this.#updateFailed(error).catch((handlerError) => {
          this.#options.log.error("update check rejection handler failed", handlerError);
        });
      });
    } catch (error) {
      this.#status = { type: "idle" };
      this.#options.log.warn("application update check failed", error);
      if (trigger === "manual") await this.#showFailure(error);
    }
  }

  /** Closes every document, then asks Electron to apply the downloaded update. */
  async restartToUpdate(): Promise<void> {
    if (this.#status.type !== "ready") return;

    try {
      if (!(await this.#options.lifecycle.confirmQuit("update"))) return;
    } catch (error) {
      this.#options.log.warn("documents could not be prepared for update", error);
      await this.#showMessage({
        type: "error",
        buttons: ["OK"],
        title: app.name,
        message: `${app.name} couldn't restart to update.`,
        detail: errorToMessage(error),
      });
      return;
    }

    this.#status = { type: "restarting" };
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      this.#relaunchInstalledVersion(error);
    }
  }

  #feed() {
    return updateFeed(shiftUpdateBaseUrl, {
      distribution: shiftDistribution,
      platform: process.platform,
      architecture: process.arch,
    });
  }

  #updateAvailable(): void {
    if (this.#status.type !== "checking") return;

    const trigger = this.#status.trigger;
    this.#status = { type: "downloading", trigger };
    if (trigger === "manual") {
      void this.#showDownloading().catch((error) => {
        this.#options.log.error("update download dialog failed", error);
      });
    }
  }

  async #updateNotAvailable(): Promise<void> {
    if (this.#status.type !== "checking") return;

    const trigger = this.#status.trigger;
    this.#status = { type: "idle" };
    if (trigger !== "manual") return;

    await this.#showMessage({
      type: "info",
      buttons: ["OK"],
      title: app.name,
      message: `${app.name} is up to date.`,
      detail: `You are running ${app.name} ${shiftProductVersion}.`,
    });
  }

  async #updateDownloaded(): Promise<void> {
    if (this.#status.type !== "downloading") return;

    this.#status = { type: "ready" };
    await this.#notifyReady();
  }

  async #updateFailed(error: unknown): Promise<void> {
    if (this.#status.type === "restarting") {
      this.#relaunchInstalledVersion(error);
      return;
    }
    if (this.#status.type !== "checking" && this.#status.type !== "downloading") return;

    const trigger = this.#status.trigger;
    this.#status = { type: "idle" };
    this.#options.log.warn("application update failed", error);
    if (trigger === "manual") await this.#showFailure(error);
  }

  async #showDownloading(): Promise<void> {
    await this.#showMessage({
      type: "info",
      buttons: ["OK"],
      title: app.name,
      message: `Downloading an ${app.name} update…`,
      detail: "You can keep working. Shift will let you know when the update is ready.",
    });
  }

  async #notifyReady(): Promise<void> {
    if (this.#readyPrompt) {
      await this.#readyPrompt;
      return;
    }

    this.#readyPrompt = this.#showReady();
    try {
      await this.#readyPrompt;
    } finally {
      this.#readyPrompt = null;
    }
  }

  async #showReady(): Promise<void> {
    if (this.#status.type !== "ready") return;

    const result = await this.#showMessage({
      type: "info",
      buttons: ["Restart and Update", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: app.name,
      message: `${app.name} is ready to update.`,
      detail: "Shift will ask about unsaved documents before restarting.",
    });
    if (result.response === 0) await this.restartToUpdate();
  }

  async #showFailure(error: unknown): Promise<void> {
    const result = await this.#showMessage({
      type: "error",
      buttons: ["View Downloads", "OK"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: app.name,
      message: `${app.name} couldn't check for updates.`,
      detail: errorToMessage(error),
    });
    if (result.response === 0) await shell.openExternal(this.#downloadsUrl());
  }

  async #showManualDownload(): Promise<void> {
    if (!app.isPackaged) {
      await this.#showMessage({
        type: "info",
        buttons: ["OK"],
        title: app.name,
        message: "Updates aren't available in development builds.",
        detail: "Package the application to exercise the update flow.",
      });
      return;
    }

    const result = await this.#showMessage({
      type: "info",
      buttons: ["View Downloads", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: app.name,
      message: "Automatic updates aren't available for this build.",
      detail: "Download the matching package from GitHub Releases.",
    });
    if (result.response === 0) await shell.openExternal(this.#downloadsUrl());
  }

  #downloadsUrl(): string {
    return shiftDistribution === "nightly" ? NIGHTLY_URL : RELEASES_URL;
  }

  #showMessage(options: MessageBoxOptions) {
    const owner = this.#options.activeWindow();
    return owner ? dialog.showMessageBox(owner.window, options) : dialog.showMessageBox(options);
  }

  #relaunchInstalledVersion(error: unknown): void {
    if (this.#relaunching) return;
    this.#relaunching = true;
    this.#options.log.error("update installation failed after document close; relaunching", error);

    try {
      app.relaunch();
    } catch (relaunchError) {
      this.#options.log.error("installed application relaunch failed", relaunchError);
    } finally {
      app.quit();
    }
  }
}
