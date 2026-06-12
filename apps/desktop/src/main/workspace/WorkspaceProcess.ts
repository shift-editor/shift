import { utilityProcess, type MessagePortMain, type UtilityProcess } from "electron";
import path from "node:path";
import { Channel, utilityProcessTransport } from "../../shared/workspace/channel";
import type { ShellCallMap, ShellEventMap } from "../../shared/workspace/protocol";
import { createShiftLogger, type ShiftLogger } from "../logging";

/**
 * Main-process controller for the workspace utility process.
 *
 * @remarks
 * Owns the `UtilityProcess` lifetime and the shell-lane channel. Main never
 * speaks font: this class only forks the process, pipes its logs, reports
 * readiness, and forwards sync-lane ports.
 */
export class WorkspaceProcess {
  readonly #log: ShiftLogger;
  #process: UtilityProcess | null = null;
  #channel: Channel<ShellCallMap, ShellEventMap> | null = null;
  #ready: Promise<void> | null = null;

  constructor(log: ShiftLogger = createShiftLogger("workspace.process")) {
    this.#log = log;
  }

  /**
   * Forks the workspace utility process if it is not already running.
   *
   * @param documentsRoot - Directory the utility process owns for working
   *   documents; passed as the process's only argument.
   */
  start(documentsRoot: string): void {
    if (this.#process) return;

    const entryPoint = path.join(__dirname, "workspace.js");
    const proc = utilityProcess.fork(entryPoint, [documentsRoot], {
      serviceName: "Shift Workspace",
      stdio: "pipe",
    });
    const channel = new Channel<ShellCallMap, ShellEventMap>(utilityProcessTransport(proc));

    this.#process = proc;
    this.#channel = channel;
    this.#ready = this.#trackReady(proc, channel);
    this.#wire(proc, channel);
  }

  /** Stops the utility process; in-flight shell-lane calls reject. */
  stop(): void {
    this.#channel?.dispose();
    this.#process = null;
    this.#channel = null;
    this.#ready = null;
  }

  /**
   * Resolves once the host announces readiness.
   *
   * @throws {Error} when the process is not running or exits before ready —
   *   the promise never hangs.
   */
  whenReady(): Promise<void> {
    return this.#ready ?? Promise.reject(new Error("workspace process is not running"));
  }

  /** Transfers the renderer's sync-lane port to the utility process. */
  connectSyncLane(port: MessagePortMain): Promise<void> {
    if (!this.#channel) {
      return Promise.reject(new Error("workspace process is not running"));
    }

    return this.#channel.call("workspace.connect", undefined, [port]);
  }

  #trackReady(proc: UtilityProcess, channel: Channel<ShellCallMap, ShellEventMap>): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      const unlisten = channel.listen("ready", () => {
        unlisten();
        this.#log.info("ready");
        resolve();
      });

      proc.once("exit", (code) => {
        unlisten();
        reject(new Error(`workspace process exited with code ${code} before ready`));
      });
    });

    // Mark handled so an exit before anything awaits readiness cannot raise
    // an unhandled rejection.
    ready.catch(() => {});

    return ready;
  }

  #wire(proc: UtilityProcess, channel: Channel<ShellCallMap, ShellEventMap>): void {
    proc.on("spawn", () => this.#log.info("spawned", proc.pid));

    proc.on("exit", (code) => {
      this.#log.info("exited", code);
      channel.dispose();

      if (this.#process === proc) {
        this.#process = null;
        this.#channel = null;
        this.#ready = null;
      }
    });

    proc.on("error", (type, location, report) => {
      this.#log.error("error", type, location, report);
    });

    proc.stdout?.on("data", (chunk) => {
      const text = String(chunk).trimEnd();
      if (text) this.#log.info(text);
    });

    proc.stderr?.on("data", (chunk) => {
      const text = String(chunk).trimEnd();
      if (text) this.#log.error(text);
    });
  }
}
