import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import type { ShiftCapabilities } from "@shift/runtime";
import type {
  SandboxCallMap,
  SandboxEventMap,
  SandboxHostCallMap,
  SandboxHostEventMap,
} from "../../shared/sandbox/protocol";
import { Channel, serveChannel, utilityProcessTransport } from "../../shared/workspace/channel";
import { createShiftLogger, type ShiftLogger } from "../logging";

const HARD_EXECUTION_TIMEOUT_MS = 5_000;

/** Owns the isolated process used for agent and future plugin code execution. */
export class SandboxRuntimeProcess {
  readonly #capabilities: ShiftCapabilities;
  readonly #log: ShiftLogger;
  #process: UtilityProcess | null = null;
  #channel: Channel<SandboxCallMap, SandboxEventMap> | null = null;
  #ready: Promise<void> | null = null;

  /**
   * Creates an unstarted sandbox process controller.
   *
   * @param capabilities - typed operations the isolated runtime may call back into.
   * @param log - destination for process lifecycle and failure diagnostics.
   */
  constructor(
    capabilities: ShiftCapabilities,
    log: ShiftLogger = createShiftLogger("sandbox.process"),
  ) {
    this.#capabilities = capabilities;
    this.#log = log;
  }

  /**
   * Starts the isolated runtime and resolves after its request lane is ready.
   *
   * @throws {Error} when the utility process exits before announcing readiness.
   */
  async start(): Promise<void> {
    if (this.#ready) return this.#ready;

    const entryPoint = path.join(__dirname, "sandbox.js");
    const proc = utilityProcess.fork(entryPoint, [], {
      serviceName: "Shift Sandbox",
      stdio: "pipe",
    });
    const transport = utilityProcessTransport(proc);
    const channel = new Channel<SandboxCallMap, SandboxEventMap>(transport);
    serveChannel<SandboxHostCallMap, SandboxHostEventMap>(transport, {
      "shift.sessions.list": () => this.#capabilities.sessions.list(),
      "shift.editor.inspect": (input) => this.#capabilities.editor.inspect(input),
    });

    this.#process = proc;
    this.#channel = channel;
    this.#ready = this.#trackReady(proc, channel);
    this.#wire(proc, channel);
    await this.#ready;
  }

  /** Stops the isolated runtime and rejects its in-flight execution requests. */
  stop(): void {
    const proc = this.#process;
    this.#process = null;
    this.#ready = null;

    this.#channel?.dispose();
    this.#channel = null;
    proc?.kill();
  }

  /**
   * Executes code in a fresh bounded QuickJS realm inside the isolated process.
   *
   * @param code - async zero-argument function source accepted by Shift code mode.
   * @remarks
   * Each call receives a fresh QuickJS realm. A hard deadline terminates the utility process;
   * the next call starts a replacement process before executing.
   *
   * @returns the JSON-compatible value returned by the function.
   * @throws {Error} when the process exits, execution fails, or the hard process deadline expires.
   */
  async execute(code: string): Promise<unknown> {
    await this.start();
    const channel = this.#channel;
    if (!channel) throw new Error("sandbox runtime is not running");

    let didTimeout = false;
    let timeout: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        didTimeout = true;
        reject(new Error("sandbox execution exceeded its hard deadline"));
      }, HARD_EXECUTION_TIMEOUT_MS);
    });

    try {
      return await Promise.race([channel.call("sandbox.execute", { code }), expired]);
    } catch (error) {
      if (didTimeout) {
        this.#log.warn("execution timed out; restarting sandbox process");
        this.stop();
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  #trackReady(
    proc: UtilityProcess,
    channel: Channel<SandboxCallMap, SandboxEventMap>,
  ): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      const onExit = (code: number) => {
        unlisten();
        reject(new Error(`sandbox process exited with code ${code} before ready`));
      };
      const unlisten = channel.listen("sandbox.ready", () => {
        proc.off("exit", onExit);
        unlisten();
        this.#log.info("ready");
        resolve();
      });
      proc.once("exit", onExit);
    });

    ready.catch(() => {});
    return ready;
  }

  #wire(proc: UtilityProcess, channel: Channel<SandboxCallMap, SandboxEventMap>): void {
    proc.on("spawn", () => this.#log.info("spawned", proc.pid));
    proc.on("exit", (code) => {
      this.#log.info("exited", code);
      channel.dispose();

      if (this.#process !== proc) return;

      this.#process = null;
      this.#channel = null;
      this.#ready = null;
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
