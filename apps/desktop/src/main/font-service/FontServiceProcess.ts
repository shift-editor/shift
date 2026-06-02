import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import type {
  FontServiceMessage,
  FontServiceRequest,
  FontServiceResponse,
} from "../../shared/font-service/protocol";

type PendingRequest = {
  resolve: (response: FontServiceResponse) => void;
  reject: (error: Error) => void;
};

export class FontServiceProcess {
  #process: UtilityProcess | null = null;
  #nextRequestId = 0;
  #pending = new Map<string, PendingRequest>();

  start(): void {
    if (this.#process) return;

    const entryPoint = path.join(__dirname, "font-service.js");
    const proc = utilityProcess.fork(entryPoint, [], {
      serviceName: "Shift Font Service",
      stdio: "pipe",
    });

    this.#process = proc;
    this.#wireDiagnostics(proc);
  }

  stop(): void {
    this.#rejectPending(new Error("Font service process stopped"));
    this.#process?.kill();
    this.#process = null;
  }

  async ping(): Promise<FontServiceResponse> {
    return this.#send({ id: this.#requestId(), type: "ping" });
  }

  #send(request: FontServiceRequest): Promise<FontServiceResponse> {
    if (!this.#process) {
      return Promise.reject(new Error("Font service process is not running"));
    }

    return new Promise((resolve, reject) => {
      this.#pending.set(request.id, { resolve, reject });
      this.#process?.postMessage(request);
    });
  }

  #requestId(): string {
    this.#nextRequestId += 1;
    return `font-service:${this.#nextRequestId}`;
  }

  #wireDiagnostics(proc: UtilityProcess): void {
    proc.on("spawn", () => {
      console.info("[font-service] spawned", proc.pid);
    });
    proc.on("exit", (code) => {
      console.info("[font-service] exited", code);
      this.#rejectPending(new Error(`Font service exited with code ${code}`));
      if (this.#process === proc) this.#process = null;
    });
    proc.on("error", (type, location, report) => {
      console.error("[font-service] error", type, location, report);
    });
    proc.on("message", (message) => {
      this.#handleMessage(message as FontServiceMessage);
    });
    proc.stdout?.on("data", (chunk) => {
      console.info("[font-service:stdout]", chunk.toString().trimEnd());
    });
    proc.stderr?.on("data", (chunk) => {
      console.error("[font-service:stderr]", chunk.toString().trimEnd());
    });
  }

  #handleMessage(message: FontServiceMessage): void {
    if (message.type === "ready") {
      console.info("[font-service] ready");
      void this.ping().then((response) => {
        console.info("[font-service] diagnostic ping", response.type);
      });
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) {
      console.warn("[font-service] received response for unknown request", message);
      return;
    }

    this.#pending.delete(message.id);
    if (message.type === "error") {
      pending.reject(new Error(message.message));
      return;
    }
    pending.resolve(message);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
