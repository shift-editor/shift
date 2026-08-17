import { errorToMessage } from "../../shared/errors";
import { loadUpdate, validateUpdateFeed } from "./updateFeed";
import { nextUpdateState } from "./nextUpdateState";
import {
  showUpdateCurrent,
  showUpdateDownloading,
  showUpdateFailure,
  showUpdateReady,
  showUpdateUnavailable,
} from "./updateDialogs";
import type {
  AppUpdaterOptions,
  Update,
  UpdateDisabledReason,
  UpdateEvent,
  UpdateState,
  UpdateTrigger,
} from "./types";

const INITIAL_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/shift-editor/shift/releases";
const NIGHTLY_URL = "https://github.com/shift-editor/shift/releases/tag/nightly";

/** Owns channel validation, Electron updater events, scheduling, and update UI. */
export class AppUpdater {
  readonly #options: AppUpdaterOptions;

  #state: UpdateState;
  #candidate: Update | null = null;
  #started = false;
  #readyPrompt: Promise<void> | null = null;

  constructor(options: AppUpdaterOptions) {
    this.#options = options;
    this.#state = initialUpdateState(options);
  }

  get state(): UpdateState {
    return this.#state;
  }

  /** Installs Electron listeners and starts quiet periodic checks for eligible builds. */
  start(): void {
    if (this.#started || this.#state.type === "disabled") return;
    this.#started = true;

    this.#options.autoUpdater.on("update-available", () => {
      this.#handleUpdateAvailable();
    });
    this.#options.autoUpdater.on("update-not-available", () => {
      void this.#handleNoUpdateAvailable().catch((error) => {
        this.#options.log.error("no-update handler failed", error);
      });
    });
    this.#options.autoUpdater.on("update-downloaded", () => {
      void this.#handleUpdateDownloaded().catch((error) => {
        this.#options.log.error("downloaded-update handler failed", error);
      });
    });
    this.#options.autoUpdater.on("error", (error) => {
      void this.#handleError(error).catch((handlerError) => {
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

  /** Checks the compiled distribution feed, deduplicating in-flight and downloaded updates. */
  async checkForUpdates(trigger: UpdateTrigger): Promise<void> {
    switch (this.#state.type) {
      case "disabled":
        if (trigger === "manual") await this.#showUnavailable(this.#state.reason);
        return;
      case "ready":
        if (trigger === "manual") await this.#notifyReady();
        return;
      case "downloading":
        if (trigger === "manual") {
          await showUpdateDownloading(
            this.#options.activeWindow(),
            this.#options.applicationName(),
            this.#state.update,
          );
        }
        return;
      case "checking":
      case "restarting":
        return;
      case "idle":
      case "current":
      case "failed":
        break;
    }

    if (!this.#transition({ type: "checkRequested", trigger })) return;

    try {
      const update = await loadUpdate(
        this.#options.feedBaseUrl,
        {
          distribution: this.#options.distribution,
          version: this.#options.productVersion,
          platform: this.#options.platform,
          architecture: this.#options.architecture,
          publicKey: this.#options.publicKey,
        },
        this.#options.fetch,
      );
      if (!update) {
        await this.#completeCurrentCheck();
        return;
      }

      await validateUpdateFeed(update, this.#options.fetch);
      this.#candidate = update;
      this.#options.autoUpdater.setFeedURL({ url: update.artifact.feedUrl });
      this.#options.log.info("checking Electron update feed", {
        distribution: update.distribution,
        version: update.version,
        platform: update.artifact.platform,
        architecture: update.artifact.architecture,
      });
      this.#options.autoUpdater.checkForUpdates();
    } catch (error) {
      await this.#fail("check", error);
    }
  }

  /** Settles open documents, then asks Electron to apply the downloaded update. */
  async restartToUpdate(): Promise<void> {
    if (this.#state.type !== "ready") return;

    try {
      if (!(await this.#options.lifecycle.confirmQuit("update"))) return;
      if (!this.#transition({ type: "restartRequested" })) {
        this.#options.lifecycle.resetQuitConfirmation();
        return;
      }

      this.#options.autoUpdater.quitAndInstall();
    } catch (error) {
      await this.#rejectRestart(error);
    }
  }

  #handleUpdateAvailable(): void {
    if (!this.#candidate) {
      void this.#fail("check", new Error("Electron reported an update without a candidate")).catch(
        (error) => {
          this.#options.log.error("missing-candidate failure handler failed", error);
        },
      );
      return;
    }

    const trigger = this.#state.type === "checking" ? this.#state.trigger : null;
    if (!this.#transition({ type: "updateAvailable", update: this.#candidate })) return;

    if (trigger === "manual") {
      void showUpdateDownloading(
        this.#options.activeWindow(),
        this.#options.applicationName(),
        this.#candidate,
      ).catch((error) => {
        this.#options.log.error("downloading dialog failed", error);
      });
    }
  }

  async #handleNoUpdateAvailable(): Promise<void> {
    await this.#completeCurrentCheck();
  }

  async #completeCurrentCheck(): Promise<void> {
    const trigger = this.#state.type === "checking" ? this.#state.trigger : null;
    this.#candidate = null;
    if (!this.#transition({ type: "noUpdateAvailable", checkedAt: new Date().toISOString() }))
      return;

    if (trigger === "manual") {
      await showUpdateCurrent(
        this.#options.activeWindow(),
        this.#options.applicationName(),
        this.#options.productVersion,
      );
    }
  }

  async #handleUpdateDownloaded(): Promise<void> {
    if (!this.#transition({ type: "updateDownloaded" })) return;
    await this.#notifyReady();
  }

  async #handleError(error: Error): Promise<void> {
    switch (this.#state.type) {
      case "checking":
        await this.#fail("check", error);
        return;
      case "downloading":
        await this.#fail("download", error);
        return;
      case "restarting":
        await this.#rejectRestart(error);
        return;
      default:
        this.#options.log.warn("ignored updater error outside active work", {
          state: this.#state.type,
          message: errorToMessage(error),
        });
    }
  }

  async #rejectRestart(error: unknown): Promise<void> {
    this.#options.lifecycle.resetQuitConfirmation();
    if (!this.#transition({ type: "restartRejected" })) return;

    await showUpdateFailure(
      this.#options.activeWindow(),
      this.#options.applicationName(),
      "restart",
      error,
    );
  }

  async #fail(phase: "check" | "download", error: unknown): Promise<void> {
    const trigger =
      this.#state.type === "checking" || this.#state.type === "downloading"
        ? this.#state.trigger
        : null;
    const message = errorToMessage(error);
    if (!this.#transition({ type: "operationFailed", phase, message })) return;

    this.#options.log.warn("application update failed", { phase, trigger, message });
    if (trigger !== "manual") return;

    const retry = await showUpdateFailure(
      this.#options.activeWindow(),
      this.#options.applicationName(),
      phase,
      error,
    );
    if (retry) await this.checkForUpdates("manual");
  }

  async #notifyReady(): Promise<void> {
    if (this.#readyPrompt) {
      await this.#readyPrompt;
      return;
    }

    this.#readyPrompt = this.#runReadyPrompt();
    try {
      await this.#readyPrompt;
    } finally {
      this.#readyPrompt = null;
    }
  }

  async #runReadyPrompt(): Promise<void> {
    if (this.#state.type !== "ready") return;
    const restart = await showUpdateReady(
      this.#options.activeWindow(),
      this.#options.applicationName(),
      this.#state.update,
    );
    if (restart) await this.restartToUpdate();
  }

  async #showUnavailable(reason: UpdateDisabledReason): Promise<void> {
    const openDownloads = await showUpdateUnavailable(
      this.#options.activeWindow(),
      this.#options.applicationName(),
      reason,
    );
    if (!openDownloads) return;

    const url = this.#options.distribution === "nightly" ? NIGHTLY_URL : RELEASES_URL;
    await this.#options.openExternal(url);
  }

  #transition(event: UpdateEvent): boolean {
    const next = nextUpdateState(this.#state, event);
    if (!next) {
      this.#options.log.warn("ignored illegal application update transition", {
        state: this.#state.type,
        event: event.type,
      });
      return false;
    }

    const previous = this.#state.type;
    this.#state = next;
    this.#options.log.info("application update state changed", {
      previous,
      next: next.type,
    });
    return true;
  }
}

function initialUpdateState(options: AppUpdaterOptions): UpdateState {
  let reason: UpdateDisabledReason | null = null;
  if (!options.isPackaged) reason = "development";
  else if (options.platform !== "darwin" && options.platform !== "win32") {
    reason = "unsupported-platform";
  } else if (options.platform === "win32" && !options.windowsUpdatesEnabled) {
    reason = "unsigned-windows";
  } else if (!options.publicKey || !options.feedBaseUrl) reason = "missing-configuration";

  return reason ? { type: "disabled", reason } : { type: "idle" };
}
