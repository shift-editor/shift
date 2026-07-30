import { errorToMessage } from "../errors";
import type { Transport } from "./channel";
import type { ByteReadableStream, ByteStreamControl, ByteStreamMessage } from "./protocol";

/** One-chunk-in-flight byte stream over a dedicated message-port transport. */
export class PortByteStream {
  readonly #transport: Transport;
  readonly #messages: unknown[] = [];
  readonly #waiters: Array<{
    resolve: (message: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  #closedError: Error | null = null;

  constructor(transport: Transport) {
    this.#transport = transport;
    transport.onMessage((message) => this.#push(message.data));
    transport.onClose(() => this.#close(new Error("byte stream port closed"), false));
  }

  /** Sends a native/web byte stream and waits for each receiver acknowledgment. */
  async send(source: ByteReadableStream<Uint8Array>): Promise<number> {
    const reader = source.getReader();
    let totalLength = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        const bytes = new Uint8Array(
          value.buffer as ArrayBuffer,
          value.byteOffset,
          value.byteLength,
        );
        const nextOffset = totalLength + bytes.byteLength;
        const controlPromise = this.#next();
        this.#transport.post({
          kind: "chunk",
          offset: totalLength,
          bytes,
        } satisfies ByteStreamMessage);
        const control = readControl(await controlPromise);
        if (control.kind === "cancel") throw new Error(control.message);
        if (control.nextOffset !== nextOffset) {
          throw new Error(`byte stream expected acknowledgment ${nextOffset}`);
        }
        totalLength = nextOffset;
      }

      this.#transport.post({ kind: "complete", totalLength } satisfies ByteStreamMessage);
      return totalLength;
    } catch (error) {
      try {
        await reader.cancel(errorToMessage(error));
      } catch (cancelError) {
        console.error("failed to cancel byte stream source", cancelError);
      }
      try {
        this.#transport.post({
          kind: "error",
          message: errorToMessage(error),
        } satisfies ByteStreamMessage);
      } catch (postError) {
        console.error("failed to report byte stream error", postError);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /** Receives ordered chunks and acknowledges only after the sink accepts each one. */
  async receive(
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void | Promise<void>,
  ): Promise<number> {
    let totalLength = 0;

    try {
      for (;;) {
        const message = readMessage(await this.#next());
        switch (message.kind) {
          case "chunk": {
            if (message.offset !== totalLength) {
              throw new Error(`byte stream chunk started at ${message.offset}, not ${totalLength}`);
            }
            await write(message.offset, message.bytes);
            totalLength += message.bytes.byteLength;
            this.#transport.post({
              kind: "ack",
              nextOffset: totalLength,
            } satisfies ByteStreamControl);
            break;
          }
          case "complete":
            if (message.totalLength !== totalLength) {
              throw new Error(
                `byte stream completed at ${message.totalLength}, not ${totalLength}`,
              );
            }
            return totalLength;
          case "error":
            throw new Error(message.message);
        }
      }
    } catch (error) {
      try {
        this.#transport.post({
          kind: "cancel",
          message: errorToMessage(error),
        } satisfies ByteStreamControl);
      } catch (cancelError) {
        console.error("failed to cancel byte stream receiver", cancelError);
      }
      throw error;
    }
  }

  close(): void {
    this.#close(new Error("byte stream closed"), true);
  }

  #push(message: unknown): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve(message);
      return;
    }

    this.#messages.push(message);
  }

  #next(): Promise<unknown> {
    const message = this.#messages.shift();
    if (message !== undefined) return Promise.resolve(message);
    if (this.#closedError) return Promise.reject(this.#closedError);

    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }

  #close(error: Error, closeTransport: boolean): void {
    if (this.#closedError) return;
    this.#closedError = error;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error);
    this.#messages.length = 0;
    if (closeTransport) this.#transport.close();
  }
}

function readMessage(value: unknown): ByteStreamMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw new Error("byte stream received an invalid message");
  }

  const message = value as ByteStreamMessage;
  switch (message.kind) {
    case "chunk":
      if (
        !Number.isSafeInteger(message.offset) ||
        message.offset < 0 ||
        !(message.bytes instanceof Uint8Array)
      ) {
        throw new Error("byte stream received an invalid chunk");
      }
      return message;
    case "complete":
      if (!Number.isSafeInteger(message.totalLength) || message.totalLength < 0) {
        throw new Error("byte stream received an invalid completion");
      }
      return message;
    case "error":
      if (typeof message.message !== "string") {
        throw new Error("byte stream received an invalid error");
      }
      return message;
    default:
      throw new Error("byte stream received an unknown message");
  }
}

function readControl(value: unknown): ByteStreamControl {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw new Error("byte stream received invalid backpressure");
  }

  const control = value as ByteStreamControl;
  switch (control.kind) {
    case "ack":
      if (!Number.isSafeInteger(control.nextOffset) || control.nextOffset < 0) {
        throw new Error("byte stream received an invalid acknowledgment");
      }
      return control;
    case "cancel":
      if (typeof control.message !== "string") {
        throw new Error("byte stream received an invalid cancellation");
      }
      return control;
    default:
      throw new Error("byte stream received unknown backpressure");
  }
}
