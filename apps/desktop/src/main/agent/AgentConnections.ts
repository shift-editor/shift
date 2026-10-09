import fs from "node:fs";
import path from "node:path";
import type { ShiftMcpActivity, ShiftMcpConnection } from "@shift/mcp";
import type { AgentConnectionsState } from "../../shared/agent/connections";
import type { ShiftLogger } from "../logging";

/** The parts of the MCP server that agent connections control. */
export interface AgentServer {
  start(): Promise<ShiftMcpConnection>;
  stop(): Promise<void>;
  readonly activity: ShiftMcpActivity;
}

export interface AgentConnectionsOptions {
  /** JSON file that stores whether agent connections are allowed. */
  settingsPath: string;
  /** This build's MCP server name, as agents should register it. */
  serverName: string;
  /** This build's fixed loopback port, or `0` to pick a free one (tests). */
  port: number;
  /** Creates a server that reports activity through the given callback. */
  createServer(onActivity: () => void): AgentServer;
  log: ShiftLogger;
}

/**
 * Whether local agents may connect, and the MCP server that follows it.
 *
 * @remarks
 * Off by default. The choice persists across launches; turning it on starts
 * the server on this build's fixed port, and turning it off stops it. A port
 * already in use leaves the setting on and reports the failure, so the user
 * can retry after closing whatever holds the port.
 */
export class AgentConnections {
  readonly #settingsPath: string;
  readonly #serverName: string;
  readonly #port: number;
  readonly #createServer: AgentConnectionsOptions["createServer"];
  readonly #log: ShiftLogger;
  readonly #listeners = new Set<(state: AgentConnectionsState) => void>();
  #allowed: boolean;
  #server: AgentServer | null = null;
  #connection: ShiftMcpConnection | null = null;
  #error: string | null = null;
  #transition: Promise<void> = Promise.resolve();

  constructor(options: AgentConnectionsOptions) {
    this.#settingsPath = options.settingsPath;
    this.#serverName = options.serverName;
    this.#port = options.port;
    this.#createServer = options.createServer;
    this.#log = options.log;
    this.#allowed = readAllowed(options.settingsPath);
  }

  get state(): AgentConnectionsState {
    return {
      allowed: this.#allowed,
      status: this.#status(),
      serverName: this.#serverName,
      url: this.#connection?.url ?? `http://127.0.0.1:${this.#port}/mcp`,
      error: this.#error,
      activity: this.#server?.activity ?? { lastRequestAt: null, clients: [] },
    };
  }

  #status(): AgentConnectionsState["status"] {
    if (this.#connection) return "listening";
    if (this.#error) return "failed";
    return "off";
  }

  /** Subscribes to state changes; returns an unsubscribe function. */
  onChanged(listener: (state: AgentConnectionsState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Starts the server at launch when connections were left allowed. */
  resume(): Promise<void> {
    return this.#serialize(() => (this.#allowed ? this.#startServer() : Promise.resolve()));
  }

  /** Persists the choice and starts or stops the server to match it. */
  setAllowed(allowed: boolean): Promise<void> {
    return this.#serialize(async () => {
      this.#allowed = allowed;
      writeAllowed(this.#settingsPath, allowed);
      if (allowed) await this.#startServer();
      else await this.#stopServer();
      this.#publish();
    });
  }

  /** Stops the server without changing the persisted choice (app quit). */
  shutdown(): Promise<void> {
    return this.#serialize(() => this.#stopServer());
  }

  async #startServer(): Promise<void> {
    if (this.#server) return;

    const server = this.#createServer(() => this.#publish());
    try {
      this.#connection = await server.start();
      this.#server = server;
      this.#error = null;
      this.#log.info("agent connections started", { url: this.#connection.url });
    } catch (error) {
      await server.stop().catch(() => {});
      this.#error = startFailure(error, this.#port);
      this.#log.error("failed to start agent connections", error);
    }
    this.#publish();
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#connection = null;
    this.#error = null;
    if (!server) return;

    try {
      await server.stop();
    } catch (error) {
      this.#log.error("failed to stop agent connections", error);
    }
  }

  #publish(): void {
    const state = this.state;
    for (const listener of this.#listeners) listener(state);
  }

  /** Runs start/stop transitions one at a time, in request order. */
  #serialize(transition: () => Promise<void>): Promise<void> {
    const next = this.#transition.then(transition, transition);
    this.#transition = next.catch(() => {});
    return next;
  }
}

function startFailure(error: unknown, port: number): string {
  if ((error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE") {
    return `Port ${port} is already in use. Quit the app using it, then turn agent connections on again.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function readAllowed(settingsPath: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { allowed?: unknown };
    return parsed.allowed === true;
  } catch {
    return false;
  }
}

function writeAllowed(settingsPath: string, allowed: boolean): void {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ allowed }, null, 2));
    fs.renameSync(temporaryPath, settingsPath);
  } catch (error) {
    console.warn("failed to persist agent connection setting", error);
  }
}
