import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { watch, type FSWatcher } from "chokidar";
import type { AppConfigState, ThemeSetting } from "../../shared/config/config";
import type { ShiftLogger } from "../logging";
import { readConfig, setConfigTheme, type ConfigValues } from "./configToml";

export const CONFIG_FILE_NAME = "config.toml";

/**
 * How long after watching starts to reread the files once more: macOS can miss
 * changes made in the first moments of a new watch, longer on a busy machine.
 */
const WATCH_SETTLE_MS = 1000;

const EMPTY_VALUES: ConfigValues = { theme: null };

export interface AppConfigOptions {
  /** This build's config folder; see `configDirectory`. */
  directory: string;
  log: ShiftLogger;
}

/**
 * Owns this build's `config.toml`: reads it, watches its folder, and applies
 * changes made in Settings or in any other program.
 *
 * @remarks
 * The file is the source of truth. When it stops parsing, the last valid values
 * stay in effect and the state reports the error; Settings writes are refused
 * until the file is fixed, so they can never overwrite the user's work.
 */
export class AppConfig {
  readonly #directory: string;
  readonly #filePath: string;
  readonly #log: ShiftLogger;
  readonly #listeners = new Set<(state: AppConfigState) => void>();
  #state: AppConfigState;
  #watcher: FSWatcher | null = null;
  #settleTimer: NodeJS.Timeout | null = null;
  /** The real file behind a symlinked `config.toml`, whose folder is also watched. */
  #symlinkTarget: string | null = null;

  constructor(options: AppConfigOptions) {
    this.#directory = options.directory;
    this.#filePath = path.join(options.directory, CONFIG_FILE_NAME);
    this.#log = options.log;
    this.#state = this.#read(EMPTY_VALUES);
  }

  get state(): AppConfigState {
    return this.#state;
  }

  /** Subscribes to state changes; returns the unsubscribe function. */
  onChanged(listener: (state: AppConfigState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Starts watching the config folder, creating it so it can be watched.
   *
   * @remarks
   * Watching folders rather than files sees an editor's save-by-rename and edits
   * that land right after setup. A `config.toml` symlinked from a dotfiles
   * repository also has its target's folder watched, moved when the link is
   * repointed. A folder that cannot be created or watched leaves the config
   * readable at startup and through Settings, but external edits then need a
   * restart.
   *
   * @returns a promise that settles once changes are being observed.
   */
  watch(): Promise<void> {
    if (this.#watcher) return Promise.resolve();
    try {
      fs.mkdirSync(this.#directory, { recursive: true });
    } catch (error) {
      this.#log.warn("cannot create config folder", { directory: this.#directory, error });
      return Promise.resolve();
    }
    this.#symlinkTarget = this.#readSymlinkTarget();
    const folders = [this.#directory];
    if (this.#symlinkTarget) folders.push(path.dirname(this.#symlinkTarget));
    const watcher = watch(folders, { ignoreInitial: true, depth: 0, followSymlinks: false })
      .on("all", (_event, changedPath) => {
        if (changedPath === this.#filePath || changedPath === this.#symlinkTarget) this.reload();
      })
      .on("error", (error) => {
        this.#log.warn("config watcher stopped", { error });
        this.#closeWatcher();
      });
    this.#watcher = watcher;
    return new Promise((resolve) => {
      watcher.once("ready", () => {
        // The files may have changed between construction and watching, or
        // while the new watch was still settling.
        this.reload();
        this.#settleTimer = setTimeout(() => {
          this.#settleTimer = null;
          this.reload();
        }, WATCH_SETTLE_MS);
        resolve();
      });
    });
  }

  /** Stops watching the config folder. */
  close(): void {
    this.#closeWatcher();
    this.#listeners.clear();
  }

  /** Rereads `config.toml` and publishes the state when it changed. */
  reload(): void {
    this.#followSymlink();
    this.#publish(this.#read({ theme: this.#state.theme }));
  }

  /**
   * Writes the theme setting to `config.toml`, creating the file if needed.
   *
   * @remarks
   * The new text is flushed to a temporary file beside the real file and renamed
   * over it, so a crash leaves either the old or the new file. A symlinked
   * `config.toml` stays a symlink: the write goes to its target.
   *
   * @throws Error when the file does not parse or its `theme` cannot be edited
   * safely; the file is left unchanged.
   */
  setTheme(theme: ThemeSetting): AppConfigState {
    const next = setConfigTheme(this.#readSource(), theme);
    fs.mkdirSync(this.#directory, { recursive: true });
    writeFileAtomic(resolveTarget(this.#filePath), next);
    this.reload();
    return this.#state;
  }

  /** Reads the file, keeping `lastValid` values when it has an error. */
  #read(lastValid: ConfigValues): AppConfigState {
    let source: string | null;
    try {
      source = this.#readSource();
    } catch (error) {
      return {
        directory: this.#directory,
        exists: true,
        theme: lastValid.theme,
        problems: [
          {
            severity: "error",
            message: `Cannot read config.toml: ${(error as Error).message}`,
          },
        ],
      };
    }
    if (source === null) {
      return { directory: this.#directory, exists: false, theme: null, problems: [] };
    }

    const { values, problems } = readConfig(source);
    return {
      directory: this.#directory,
      exists: true,
      theme: (values ?? lastValid).theme,
      problems,
    };
  }

  /** Returns the file's text, or `null` when it does not exist. */
  #readSource(): string | null {
    try {
      return fs.readFileSync(this.#filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  #publish(state: AppConfigState): void {
    if (isDeepStrictEqual(state, this.#state)) return;
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }

  /** Moves the target-folder watch after `config.toml` is linked, unlinked, or repointed. */
  #followSymlink(): void {
    if (!this.#watcher) return;
    const target = this.#readSymlinkTarget();
    if (target === this.#symlinkTarget) return;
    const previousFolder = this.#symlinkTarget && path.dirname(this.#symlinkTarget);
    const nextFolder = target && path.dirname(target);
    // The config folder itself stays watched, even when the link points inside it.
    if (previousFolder && previousFolder !== this.#directory) this.#watcher.unwatch(previousFolder);
    if (nextFolder && nextFolder !== this.#directory) this.#watcher.add(nextFolder);
    this.#symlinkTarget = target;
  }

  /** Returns the real file behind a symlinked `config.toml`, or `null`. */
  #readSymlinkTarget(): string | null {
    try {
      if (!fs.lstatSync(this.#filePath).isSymbolicLink()) return null;
      return fs.realpathSync(this.#filePath);
    } catch {
      return null;
    }
  }

  #closeWatcher(): void {
    if (this.#settleTimer) clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
    void this.#watcher?.close();
    this.#watcher = null;
  }
}

/** Returns the file a symlink at `filePath` points to, or `filePath` itself. */
function resolveTarget(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return filePath;
    throw error;
  }
}

/** Replaces `filePath` with `contents` through a flushed temporary file and a rename. */
function writeFileAtomic(filePath: string, contents: string): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    const descriptor = fs.openSync(temporaryPath, "w");
    try {
      fs.writeFileSync(descriptor, contents);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
