import type { MessagePortMain, UtilityProcess } from "electron";
import type { MessagePort as NodeMessagePort } from "node:worker_threads";

/** One delivered transport message: structured-clone payload plus transferred ports. */
export type TransportMessage = { data: unknown; ports: readonly unknown[] };

/**
 * Required-shape message transport the channel runs over.
 *
 * @remarks
 * Platform differences (DOM ports, Electron ports, utility processes) live in
 * the adapter functions in this module, never in the channel itself.
 */
export type Transport = {
  post(message: unknown, transfer?: unknown[]): void;
  onMessage(listener: (message: TransportMessage) => void): void;
  close(): void;
};

/** Contract shape for one lane's request/response operations. */
export type CallMap = Record<string, { request: unknown; response: unknown }>;

/** Contract shape for one lane's one-way events. */
export type EventMap = Record<string, unknown>;

/** Per-request context handed to server handlers; carries transferred ports. */
export type HandlerContext = { ports: readonly unknown[] };

/** Handler object dispatched by {@link serveChannel}; one handler per call type. */
export type ChannelHandlers<Calls extends CallMap> = {
  [T in keyof Calls]: (
    payload: Calls[T]["request"],
    context: HandlerContext,
  ) => Calls[T]["response"] | Promise<Calls[T]["response"]>;
};

/** Server half returned by {@link serveChannel}. */
export type ChannelServer<Events extends EventMap> = {
  emit<T extends keyof Events & string>(type: T, payload: Events[T]): void;
  dispose(): void;
};

type RequestEnvelope = {
  kind: "request";
  id: string;
  type: string;
  payload: unknown;
};

type ResponseEnvelope =
  | { kind: "response"; id: string; ok: true; result: unknown }
  | { kind: "response"; id: string; ok: false; error: { message: string } };

type EventEnvelope = { kind: "event"; type: string; payload: unknown };

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Client half of a message lane: correlated calls plus event subscriptions.
 *
 * @remarks
 * One `Channel` owns one transport. Disposing the channel rejects every
 * in-flight call and closes the transport; the instance is not reusable.
 */
export class Channel<Calls extends CallMap, Events extends EventMap> {
  readonly #transport: Transport;
  readonly #pending = new Map<string, PendingCall>();
  readonly #listeners = new Map<string, Set<(payload: unknown) => void>>();
  #nextRequestId = 0;
  #disposed = false;

  constructor(transport: Transport) {
    this.#transport = transport;
    transport.onMessage((message) => this.#handleMessage(message.data));
  }

  /**
   * Calls a typed operation on the other side of the lane.
   *
   * @param payload - Pass `undefined` for void requests; there are no overloads.
   * @param transfer - Ports to transfer alongside the request; they arrive in
   *   the server handler's {@link HandlerContext}.
   * @throws {Error} when the remote handler throws or the channel is disposed
   *   before the response arrives.
   */
  call<T extends keyof Calls & string>(
    type: T,
    payload: Calls[T]["request"],
    transfer?: unknown[],
  ): Promise<Calls[T]["response"]> {
    if (this.#disposed) {
      return Promise.reject(new Error("channel disposed"));
    }

    this.#nextRequestId += 1;
    const id = String(this.#nextRequestId);

    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.#transport.post({ kind: "request", id, type, payload }, transfer);
    });
  }

  /** Subscribes to a typed event from the other side; returns an unlisten function. */
  listen<T extends keyof Events & string>(
    type: T,
    listener: (payload: Events[T]) => void,
  ): () => void {
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }

    const entry = listener as (payload: unknown) => void;
    listeners.add(entry);

    return () => {
      listeners.delete(entry);
    };
  }

  /** Rejects all pending calls, drops listeners, and closes the transport. */
  dispose(): void {
    this.#disposed = true;

    const error = new Error("channel disposed");
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }

    this.#pending.clear();
    this.#listeners.clear();
    this.#transport.close();
  }

  #handleMessage(data: unknown): void {
    if (isResponseEnvelope(data)) {
      this.#settle(data);
      return;
    }

    if (isEventEnvelope(data)) {
      this.#dispatchEvent(data);
    }
  }

  #settle(response: ResponseEnvelope): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;

    this.#pending.delete(response.id);

    if (!response.ok) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  #dispatchEvent(event: EventEnvelope): void {
    const listeners = this.#listeners.get(event.type);
    if (!listeners) return;

    for (const listener of listeners) {
      listener(event.payload);
    }
  }
}

/**
 * Serves one lane: dispatches incoming requests to `handlers` and turns thrown
 * errors into failed responses.
 *
 * @returns `emit` for one-way events to the client and `dispose` to close the
 *   transport.
 */
export function serveChannel<Calls extends CallMap, Events extends EventMap>(
  transport: Transport,
  handlers: ChannelHandlers<Calls>,
): ChannelServer<Events> {
  const respond = (response: ResponseEnvelope) => transport.post(response);

  const dispatch = async (request: RequestEnvelope, ports: readonly unknown[]): Promise<void> => {
    const handler = handlers[request.type as keyof Calls] as
      | ((payload: unknown, context: HandlerContext) => unknown)
      | undefined;

    if (!handler) {
      respond({
        kind: "response",
        id: request.id,
        ok: false,
        error: { message: `unknown request type "${request.type}"` },
      });
      return;
    }

    try {
      const result = await handler(request.payload, { ports });
      respond({ kind: "response", id: request.id, ok: true, result });
    } catch (error) {
      respond({
        kind: "response",
        id: request.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  transport.onMessage((message) => {
    if (!isRequestEnvelope(message.data)) return;

    void dispatch(message.data, message.ports);
  });

  return {
    emit: (type, payload) => transport.post({ kind: "event", type, payload }),
    dispose: () => transport.close(),
  };
}

function isRequestEnvelope(data: unknown): data is RequestEnvelope {
  const candidate = data as RequestEnvelope | null;

  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.kind === "request" &&
    typeof candidate.id === "string" &&
    typeof candidate.type === "string"
  );
}

function isResponseEnvelope(data: unknown): data is ResponseEnvelope {
  const candidate = data as ResponseEnvelope | null;

  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.kind === "response" &&
    typeof candidate.id === "string"
  );
}

function isEventEnvelope(data: unknown): data is EventEnvelope {
  const candidate = data as EventEnvelope | null;

  return (
    typeof candidate === "object" &&
    candidate !== null &&
    candidate.kind === "event" &&
    typeof candidate.type === "string"
  );
}

/** Wraps a DOM `MessagePort` (renderer side of the sync lane). */
export function domPortTransport(port: MessagePort): Transport {
  return {
    post: (message, transfer) => port.postMessage(message, (transfer ?? []) as Transferable[]),
    onMessage: (listener) => {
      port.onmessage = (event) => listener({ data: event.data, ports: event.ports });
    },
    close: () => port.close(),
  };
}

/** Wraps an Electron `MessagePortMain` (main side of a transferred port). */
export function electronPortTransport(port: MessagePortMain): Transport {
  return {
    post: (message, transfer) => port.postMessage(message, (transfer ?? []) as MessagePortMain[]),
    onMessage: (listener) => {
      port.on("message", (event) => listener({ data: event.data, ports: event.ports }));
      port.start();
    },
    close: () => port.close(),
  };
}

/**
 * Wraps `process.parentPort` inside an Electron utility process.
 *
 * @remarks
 * Electron's parent port cannot transfer ports child → main, so posting with a
 * transfer list throws instead of silently dropping the ports. The lane itself
 * lives for the process lifetime; `close` is a no-op.
 */
export function parentPortTransport(): Transport {
  const port = process.parentPort;

  return {
    post: (message, transfer) => {
      if (transfer?.length) {
        throw new Error("parent port cannot transfer ports to the main process");
      }

      port.postMessage(message);
    },
    onMessage: (listener) =>
      port.on("message", (event) => listener({ data: event.data, ports: event.ports })),
    close: () => {},
  };
}

/** Wraps a forked `UtilityProcess` (main side of the shell lane); delivers bare data. */
export function utilityProcessTransport(child: UtilityProcess): Transport {
  return {
    post: (message, transfer) => child.postMessage(message, (transfer ?? []) as MessagePortMain[]),
    onMessage: (listener) => child.on("message", (data) => listener({ data, ports: [] })),
    close: () => {
      child.kill();
    },
  };
}

/**
 * Wraps a `worker_threads` MessagePort for in-process tests.
 *
 * @remarks
 * Node ports implement the web `MessagePort` API; the adapter uses that flavor
 * because the EventEmitter `"message"` flavor drops transferred ports instead
 * of surfacing them in `MessageEvent.ports`.
 */
export function nodePortTransport(port: NodeMessagePort): Transport {
  return domPortTransport(port as unknown as MessagePort);
}
