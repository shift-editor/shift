import { app, dialog, shell, type MessageBoxOptions } from "electron";
import { message } from "../../shared/messages";
import type { UpdateNotice } from "../../shared/update/types";
import { shiftDistribution, shiftProductVersion, shiftUpdateBaseUrl } from "../release";
import { ElectronUpdateBackend } from "./ElectronUpdateBackend";
import { SimulatedUpdateBackend } from "./SimulatedUpdateBackend";
import { detectLinuxInstallation } from "./linuxInstallation";
import { updateFeed } from "./updateFeed";
import { sameNotice, updateNotice } from "./updateNotice";
import type {
  AppUpdaterOptions,
  LinuxInstallation,
  UpdateBackend,
  UpdateStatus,
  UpdateTrigger,
} from "./types";

const INITIAL_CHECK_DELAY_MS = 30_000;
const SIMULATED_CHECK_DELAY_MS = 3_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/shift-editor/shift/releases";
const NIGHTLY_URL = "https://github.com/shift-editor/shift/releases/tag/nightly";

/**
 * Owns application update checks, user consent, download progress, and restart
 * safety, and tells every window what its update strip shows.
 */
export class AppUpdater {
  readonly #options: AppUpdaterOptions;
  readonly #linuxInstallation: LinuxInstallation | null =
    process.platform === "linux"
      ? detectLinuxInstallation(process.env.APPIMAGE, process.resourcesPath)
      : null;
  readonly #backend: UpdateBackend | null;

  #status: UpdateStatus = { type: "idle" };
  /** Whether the user chose Later for the available or ready update. */
  #putOff = false;
  #notice: UpdateNotice = { type: "hidden" };
  #started = false;
  #relaunching = false;

  /**
   * Creates the application updater.
   *
   * @param options - app-shell dependencies used for document safety, window ownership, and logging.
   */
  constructor(options: AppUpdaterOptions) {
    this.#options = options;
    this.#backend = this.#createBackend();
  }

  /** What the update strip shows now. */
  get notice(): UpdateNotice {
    return this.#notice;
  }

  /** Installs backend listeners and schedules quiet checks for eligible builds. */
  start(): void {
    const backend = this.#backend;
    if (this.#started || !backend) return;
    this.#started = true;

    backend.listen({
      available: (version) => this.#updateAvailable(version),
      notAvailable: () => {
        void this.#updateNotAvailable().catch((error) => {
          this.#options.log.error("update-not-available handler failed", error);
        });
      },
      progress: (percent) => this.#downloadProgress(percent),
      downloaded: () => this.#updateDownloaded(),
      error: (error) => {
        void this.#updateFailed(error).catch((handlerError) => {
          this.#options.log.error("updater error handler failed", handlerError);
        });
      },
    });

    const delay = app.isPackaged ? INITIAL_CHECK_DELAY_MS : SIMULATED_CHECK_DELAY_MS;
    const initialCheck = setTimeout(() => {
      void this.checkForUpdates("automatic").catch((error) => {
        this.#options.log.error("initial update check failed", error);
      });
    }, delay);
    initialCheck.unref();

    const periodicCheck = setInterval(() => {
      void this.checkForUpdates("automatic").catch((error) => {
        this.#options.log.error("periodic update check failed", error);
      });
    }, CHECK_INTERVAL_MS);
    periodicCheck.unref();
  }

  /**
   * Checks the compiled channel, deduplicating checks, downloads, and restart
   * prompts. A manual check shows a strip the user put off again.
   */
  async checkForUpdates(trigger: UpdateTrigger): Promise<void> {
    const backend = this.#backend;
    if (!backend) {
      if (trigger === "manual") await this.#showManualDownload();
      return;
    }

    switch (this.#status.type) {
      case "checking":
      case "restarting":
      case "downloading":
        return;
      case "available":
      case "ready":
        if (trigger === "manual") this.#setPutOff(false);
        return;
      case "idle":
        break;
    }

    this.#setStatus({ type: "checking", trigger });
    this.#options.log.info("checking for application updates", {
      distribution: shiftDistribution,
      platform: process.platform,
      architecture: process.arch,
    });

    try {
      await backend.check();
    } catch (error) {
      await this.#updateFailed(error);
    }
  }

  /** Downloads the available update; the strip shows its progress. */
  async startDownload(): Promise<void> {
    const backend = this.#backend;
    if (!backend || this.#status.type !== "available") return;

    this.#putOff = false;
    this.#setStatus({ type: "downloading", version: this.#status.version, percent: 0 });

    try {
      await backend.download();
    } catch (error) {
      // Only a download still in progress fails; `#updateFailed` ignores any later state.
      await this.#updateFailed(error);
    }
  }

  /** Hides the strip for the available or ready update, keeping the update itself. */
  later(): void {
    if (this.#status.type !== "available" && this.#status.type !== "ready") return;

    this.#setPutOff(true);
  }

  /** Closes every document, then asks the backend to apply the downloaded update. */
  async restartToUpdate(): Promise<void> {
    const backend = this.#backend;
    if (!backend || this.#status.type !== "ready") return;

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

    this.#setStatus({ type: "restarting" });
    this.#options.log.info("update installation beginning");
    try {
      backend.install();
    } catch (error) {
      this.#relaunchInstalledVersion(error);
    }
  }

  #createBackend(): UpdateBackend | null {
    if (!app.isPackaged) {
      return process.env.SHIFT_SIMULATE_UPDATE === "1" ? new SimulatedUpdateBackend() : null;
    }

    const feed = updateFeed(shiftUpdateBaseUrl, {
      distribution: shiftDistribution,
      platform: process.platform,
      architecture: process.arch,
      linuxInstallation: this.#linuxInstallation,
    });
    return feed ? new ElectronUpdateBackend(feed, this.#options.log) : null;
  }

  #setStatus(status: UpdateStatus): void {
    this.#status = status;
    this.#publish();
  }

  #setPutOff(putOff: boolean): void {
    this.#putOff = putOff;
    this.#publish();
  }

  #publish(): void {
    const notice = updateNotice(this.#status, this.#putOff);
    if (sameNotice(notice, this.#notice)) return;

    this.#notice = notice;
    this.#options.broadcast(notice);
  }

  #updateAvailable(version: string): void {
    if (this.#status.type !== "checking") return;

    this.#putOff = false;
    this.#setStatus({ type: "available", version });
  }

  async #updateNotAvailable(): Promise<void> {
    if (this.#status.type !== "checking") return;

    const trigger = this.#status.trigger;
    this.#setStatus({ type: "idle" });
    if (trigger !== "manual") return;

    await this.#showMessage({
      type: "info",
      buttons: [message("action.ok")],
      title: app.name,
      message: message("update.current.message", { applicationName: app.name }),
      detail: message("update.current.detail", { version: shiftProductVersion }),
    });
  }

  #downloadProgress(percent: number): void {
    if (this.#status.type !== "downloading") return;

    const clamped = Math.min(100, Math.max(0, percent));
    this.#setStatus({ ...this.#status, percent: clamped });
  }

  #updateDownloaded(): void {
    if (this.#status.type !== "downloading") return;

    this.#putOff = false;
    this.#setStatus({ type: "ready", version: this.#status.version });
  }

  async #updateFailed(error: unknown): Promise<void> {
    switch (this.#status.type) {
      case "restarting":
        this.#relaunchInstalledVersion(error);
        return;
      case "checking": {
        const trigger = this.#status.trigger;
        this.#setStatus({ type: "idle" });
        this.#options.log.warn("application update check failed", error);
        if (trigger === "manual") await this.#showFailure();
        return;
      }
      case "downloading": {
        this.#setStatus({ type: "available", version: this.#status.version });
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

    if (this.#linuxInstallation === "systemPackage") {
      await this.#showMessage({
        type: "info",
        buttons: [message("action.ok")],
        title: app.name,
        message: message("update.packageManager.message", { applicationName: app.name }),
        detail: message("update.packageManager.detail"),
      });
      return;
    }

    const readOnlyAppImage = this.#linuxInstallation === "readOnlyAppImage";
    const result = await this.#showMessage({
      type: "info",
      buttons: [message("action.viewDownloads"), message("action.cancel")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: app.name,
      message: message("update.manualOnly.message"),
      detail: readOnlyAppImage
        ? message("update.readOnlyAppImage.detail", { applicationName: app.name })
        : message("update.manualOnly.detail"),
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
