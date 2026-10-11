import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { AppConfigState } from "../../shared/config/config";
import type { ShiftLogger } from "../logging";
import { readConfig, setConfigTheme, type ConfigValues } from "./configToml";

export const CONFIG_FILE_NAME = "config.toml";

/** Editors save through temporary files and renames; one reload covers the burst. */
const RELOAD_DELAY_MS = 50;

const EMPTY_VALUES: ConfigValues = { theme: null };

export interface AppConfigOptions {
  /** This build's config folder; see `configDirectory`. */
  directory: string;
  log: Pick<ShiftLogger, "warn">;
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
  readonly #log: AppConfigOptions["log"];
  readonly #listeners = new Set<(state: AppConfigState) => void>();
  #state: AppConfigState;
  #watcher: fs.FSWatcher | null = null;
  #reloadTimer: NodeJS.Timeout | null = null;

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
   * A folder that cannot be created or watched leaves the config readable at
   * startup and through Settings, but external edits then need a restart.
   */
  watch(): void {
    if (this.#watcher) return;
    try {
      fs.mkdirSync(this.#directory, { recursive: true });
      this.#watcher = fs.watch(this.#directory, (_event, fileName) => {
        if (fileName !== null && fileName !== CONFIG_FILE_NAME) return;
        this.#scheduleReload();
      });
      this.#watcher.on("error", (error) => {
        this.#log.warn("config watcher stopped", { error });
        this.#closeWatcher();
      });
    } catch (error) {
      this.#log.warn("cannot watch config folder", { directory: this.#directory, error });
    }
    // The file may have changed between construction and watching.
    this.reload();
  }

  /** Stops watching the config folder. */
  close(): void {
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
    this.#reloadTimer = null;
    this.#closeWatcher();
    this.#listeners.clear();
  }

  /** Rereads `config.toml` and publishes the state when it changed. */
  reload(): void {
    this.#publish(this.#read({ theme: this.#state.theme }));
  }

  /**
   * Writes the theme selection to `config.toml`, creating the file if needed.
   *
   * @throws Error when the file does not parse or its `theme` cannot be edited
   * safely; the file is left unchanged.
   */
  setTheme(theme: string): AppConfigState {
    const source = this.#readSource();
    if (source !== null && readConfig(source).values === null) {
      throw new Error("config.toml has errors; fix it before changing settings in Shift.");
    }

    const next = setConfigTheme(source, theme);
    fs.mkdirSync(this.#directory, { recursive: true });
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, next);
    fs.renameSync(temporaryPath, this.#filePath);
    this.reload();
    return this.#state;
  }

  #scheduleReload(): void {
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
    this.#reloadTimer = setTimeout(() => {
      this.#reloadTimer = null;
      this.reload();
    }, RELOAD_DELAY_MS);
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
            line: null,
            column: null,
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

  #closeWatcher(): void {
    this.#watcher?.close();
    this.#watcher = null;
  }
}
