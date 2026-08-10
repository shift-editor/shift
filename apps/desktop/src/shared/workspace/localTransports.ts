import type { MessagePortMain, UtilityProcess } from "electron";
import type { MessagePort as NodeMessagePort } from "node:worker_threads";
import type { Transport } from "./channel";

/** Wraps a DOM `MessagePort` (renderer side of the sync lane). */
export function domPortTransport(port: MessagePort): Transport {
  return {
    post: (message, transfer) => port.postMessage(message, (transfer ?? []) as Transferable[]),
    onMessage: (listener) => {
      port.onmessage = (event) => listener({ data: event.data, ports: event.ports });
      port.start();
    },
    // DOM MessagePort has no remote-close event. Ordered shutdown is delivered
    // through the channel close envelope instead.
    onClose: () => {},
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
    onClose: (listener) => port.on("close", listener),
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
    onClose: () => {},
    close: () => {},
  };
}

/** Wraps a forked `UtilityProcess` (main side of the shell lane); delivers bare data. */
export function utilityProcessTransport(child: UtilityProcess): Transport {
  return {
    post: (message, transfer) => child.postMessage(message, (transfer ?? []) as MessagePortMain[]),
    onMessage: (listener) => child.on("message", (data) => listener({ data, ports: [] })),
    onClose: (listener) => child.on("exit", listener),
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
  return {
    ...domPortTransport(port as unknown as MessagePort),
    onClose: (listener) => port.on("close", listener),
  };
}
