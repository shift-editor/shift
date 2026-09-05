import { app, dialog, shell, type MessageBoxOptions } from "electron";
import electronUpdater from "electron-updater";
import path from "node:path";
import { message } from "../../shared/messages";
import type { UpdateProgress } from "../../shared/update/types";
import { shiftDistribution, shiftProductVersion, shiftUpdateBaseUrl } from "../release";
import { UpdateWindow } from "./UpdateWindow";
import { updateFeed } from "./updateFeed";
import type { AppUpdaterOptions, UpdateStatus, UpdateTrigger } from "./types";

const INITIAL_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/shift-editor/shift/releases";
const NIGHTLY_URL = "https://github.com/shift-editor/shift/releases/tag/nightly";
const { autoUpdater, CancellationToken } = electronUpdater;

/** Owns application update checks, user consent, download progress, and restart safety. */
export class AppUpdater {
  readonly #options: AppUpdaterOptions;
  readonly #updateWindow: UpdateWindow;

  #status: UpdateStatus = { type: "idle" };
  #started = false;
  #downloadCancellationToken: InstanceType<typeof CancellationToken> | null = null;
  #relaunching = false;

  /**
   * Creates the application updater and its lazy progress window.
   *
   * @param options - app-shell dependencies used for document safety, window ownership, and logging.
   */
  constructor(options: AppUpdaterOptions) {
    this.#options = options;
    this.#updateWindow = new UpdateWindow(path.join(__dirname, "preload.js"), options.log, () =>
      this.#updateWindowClosed(),
    );
  }

  /** Installs Electron listeners and schedules quiet checks for eligible builds. */
  start(): void {
    if (this.#started || !app.isPackaged || !this.#feed()) return;
    this.#started = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = this.#options.log;
    autoUpdater.on("update-available", (info) => this.#updateAvailable(info.version));
    autoUpdater.on("update-not-available", () => {
      void this.#updateNotAvailable().catch((error) => {
        this.#options.log.error("update-not-available handler failed", error);
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      this.#downloadProgress({
        percent: Math.min(100, Math.max(0, progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });
    autoUpdater.on("update-downloaded", () => this.#updateDownloaded());
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
      case "available":
        if (trigger === "manual") this.#notifyAvailable();
        return;
      case "downloading":
        if (trigger === "manual") this.#updateWindow.showDownloading();
        return;
      case "ready":
        if (trigger === "manual") this.#notifyReady();
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
      if (trigger === "manual") await this.#showFailure();
    }
  }

  /** Downloads the available update and presents cumulative progress until completion. */
  async startDownload(): Promise<void> {
    if (this.#status.type !== "available") return;

    const version = this.#status.version;
    const cancellationToken = new CancellationToken();
    this.#status = { type: "downloading", version };
    this.#downloadCancellationToken = cancellationToken;
    this.#updateWindow.showDownloading();

    try {
      await autoUpdater.downloadUpdate(cancellationToken);
    } catch (error) {
      if (this.#status.type === "downloading") await this.#updateFailed(error);
    } finally {
      if (this.#downloadCancellationToken === cancellationToken) {
        this.#downloadCancellationToken = null;
      }
    }
  }

  /** Cancels the active download and returns the available update to a deferred state. */
  cancelDownload(): void {
    if (this.#status.type !== "downloading") return;

    const version = this.#status.version;
    this.#status = { type: "available", version };
    this.#downloadCancellationToken?.cancel();
    this.#updateWindow.close();
  }

  /** Defers the available or ready update without discarding its current state. */
  later(): void {
    if (this.#status.type !== "available" && this.#status.type !== "ready") return;

    this.#updateWindow.close();
  }

  /** Closes every document, then asks Electron to apply the downloaded update. */
  async restartToUpdate(): Promise<void> {
    if (this.#status.type !== "ready") return;

    try {
      if (!(await this.#options.lifecycle.confirmQuit("update"))) {
        this.#options.log.info("update restart blocked by document close");
        return;
      }
    } catch (error) {
      this.#options.log.warn("update restart blocked by document close failure", error);
      await this.#showMessage({
        type: "error",
        buttons: [message("action.ok")],
        title: app.name,
        message: message("update.restartBlocked.message"),
        detail: message("update.restartBlocked.detail"),
      });
      return;
    }

    this.#status = { type: "restarting" };
    this.#updateWindow.close();
    this.#options.log.info("update installation beginning");
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

  #updateAvailable(version: string): void {
    if (this.#status.type !== "checking") return;

    this.#status = { type: "available", version };
    this.#notifyAvailable();
  }

  async #updateNotAvailable(): Promise<void> {
    if (this.#status.type !== "checking") return;

    const trigger = this.#status.trigger;
    this.#status = { type: "idle" };
    if (trigger !== "manual") return;

    await this.#showMessage({
      type: "info",
      buttons: [message("action.ok")],
      title: app.name,
      message: message("update.current.message", { applicationName: app.name }),
      detail: message("update.current.detail", { version: shiftProductVersion }),
    });
  }

  #downloadProgress(progress: UpdateProgress): void {
    if (this.#status.type !== "downloading") return;

    this.#updateWindow.updateProgress(progress);
  }

  #updateDownloaded(): void {
    if (this.#status.type !== "downloading") return;

    const version = this.#status.version;
    this.#status = { type: "ready", version };
    this.#downloadCancellationToken = null;
    this.#notifyReady();
  }

  async #updateFailed(error: unknown): Promise<void> {
    switch (this.#status.type) {
      case "restarting":
        this.#relaunchInstalledVersion(error);
        return;
      case "checking": {
        const trigger = this.#status.trigger;
        this.#status = { type: "idle" };
        this.#options.log.warn("application update check failed", error);
        if (trigger === "manual") await this.#showFailure();
        return;
      }
      case "downloading": {
        const version = this.#status.version;
        this.#status = { type: "available", version };
        this.#downloadCancellationToken = null;
        this.#updateWindow.close();
        this.#options.log.warn("application update download failed", error);
        await this.#showDownloadFailure();
        return;
      }
      case "idle":
      case "available":
      case "ready":
        return;
    }
  }

  #notifyAvailable(): void {
    if (this.#status.type !== "available") return;

    this.#updateWindow.showAvailable(this.#status.version);
  }

  #notifyReady(): void {
    if (this.#status.type !== "ready") return;

    this.#updateWindow.showReady(this.#status.version);
  }

  #updateWindowClosed(): void {
    if (this.#status.type === "downloading") this.cancelDownload();
  }

  async #showFailure(): Promise<void> {
    const result = await this.#showMessage({
      type: "error",
      buttons: [message("action.viewDownloads"), message("action.ok")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: app.name,
      message: message("update.checkFailed.message", { applicationName: app.name }),
      detail: message("update.checkFailed.detail"),
    });
    if (result.response === 0) await shell.openExternal(this.#downloadsUrl());
  }

  async #showDownloadFailure(): Promise<void> {
    const result = await this.#showMessage({
      type: "error",
      buttons: [message("action.viewDownloads"), message("action.ok")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: app.name,
      message: message("update.downloadFailed.message", { applicationName: app.name }),
      detail: message("update.downloadFailed.detail"),
    });
    if (result.response === 0) await shell.openExternal(this.#downloadsUrl());
  }

  async #showManualDownload(): Promise<void> {
    if (!app.isPackaged) {
      await this.#showMessage({
        type: "info",
        buttons: [message("action.ok")],
        title: app.name,
        message: message("update.developmentUnavailable.message"),
        detail: message("update.developmentUnavailable.detail", { applicationName: app.name }),
      });
      return;
    }

    const result = await this.#showMessage({
      type: "info",
      buttons: [message("action.viewDownloads"), message("action.cancel")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: app.name,
      message: message("update.manualOnly.message"),
      detail: message("update.manualOnly.detail"),
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
