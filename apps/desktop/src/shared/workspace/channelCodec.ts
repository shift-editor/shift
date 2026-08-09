import { Decoder, Encoder, setSizeLimits } from "cbor-x";

/** Maximum encoded size of one ordinary channel request, response, event, or close frame. */
export const MAX_CHANNEL_MESSAGE_BYTES = 32 * 1024 * 1024;

const MAX_CHANNEL_ARRAY_LENGTH = 1_000_000;
const MAX_CHANNEL_OBJECT_PROPERTIES = 100_000;
const MAX_CHANNEL_VALUE_DEPTH = 64;
const MAX_CHANNEL_VALUE_COUNT = 2_000_000;

setSizeLimits({
  maxArraySize: MAX_CHANNEL_ARRAY_LENGTH,
  maxMapSize: MAX_CHANNEL_OBJECT_PROPERTIES,
  maxObjectSize: MAX_CHANNEL_OBJECT_PROPERTIES,
});

// Standard CBOR maps and RFC 8746 typed-array tags keep this wire format
// consumable by a future Rust peer. Shift messages do not need cyclic/shared
// object identity, so structured-clone extensions stay disabled.
const encoder = new Encoder({
  structuredClone: false,
  useRecords: false,
  tagUint8Array: true,
  useToJSON: false,
});
const decoder = new Decoder({
  structuredClone: false,
  useRecords: false,
  mapsAsObjects: true,
});

/** Encodes one bounded channel envelope while preserving supported typed arrays. */
export function encodeChannelMessage(message: unknown): Uint8Array<ArrayBuffer> {
  validateChannelMessage(message);
  const encoded = encoder.encode(message);
  if (encoded.byteLength > MAX_CHANNEL_MESSAGE_BYTES) {
    throw new Error(
      `channel message has ${encoded.byteLength} bytes; limit is ${MAX_CHANNEL_MESSAGE_BYTES}`,
    );
  }

  const result = new Uint8Array(encoded.byteLength);
  result.set(encoded);
  return result;
}

/** Decodes and validates one complete bounded channel envelope. */
export function decodeChannelMessage(message: ArrayBuffer | ArrayBufferView): unknown {
  const encoded = encodedBytes(message);
  if (encoded.byteLength > MAX_CHANNEL_MESSAGE_BYTES) {
    throw new Error(
      `channel message has ${encoded.byteLength} bytes; limit is ${MAX_CHANNEL_MESSAGE_BYTES}`,
    );
  }

  let decoded: unknown;
  try {
    decoded = decoder.decode(encoded);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid CBOR channel message: ${detail}`);
  }

  validateChannelMessage(decoded);
  return decoded;
}

function encodedBytes(message: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }

  return new Uint8Array(message);
}

function validateChannelMessage(message: unknown): void {
  const budget = { remaining: MAX_CHANNEL_VALUE_COUNT };
  validateChannelValue(message, 0, budget);
  if (!isPlainObject(message)) throw new Error("channel message must be an object");

  switch (message.kind) {
    case "request":
      requireString(message, "id");
      requireString(message, "type");
      return;
    case "response":
      requireString(message, "id");
      if (message.ok === true) return;
      if (message.ok !== false || !isPlainObject(message.error)) {
        throw new Error("channel response must carry a result or error");
      }
      requireString(message.error, "message");
      return;
    case "event":
      requireString(message, "type");
      return;
    case "close":
      return;
    default:
      throw new Error("unknown channel message kind");
  }
}

function validateChannelValue(value: unknown, depth: number, budget: { remaining: number }): void {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw new Error("channel message contains too many values");
  if (depth > MAX_CHANNEL_VALUE_DEPTH) throw new Error("channel message is nested too deeply");

  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("channel message contains a non-finite number");
    return;
  }
  if (value instanceof Float64Array) {
    if (value.byteLength > MAX_CHANNEL_MESSAGE_BYTES) {
      throw new Error("channel message contains an oversized Float64Array");
    }
    for (const number of value) {
      if (!Number.isFinite(number)) {
        throw new Error("channel message contains a non-finite Float64Array value");
      }
    }
    return;
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength > MAX_CHANNEL_MESSAGE_BYTES) {
      throw new Error("channel message contains an oversized Uint8Array");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CHANNEL_ARRAY_LENGTH) {
      throw new Error(
        `channel array has ${value.length} values; limit is ${MAX_CHANNEL_ARRAY_LENGTH}`,
      );
    }

    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new Error("channel message contains a sparse array");
      validateChannelValue(value[index], depth + 1, budget);
    }
    return;
  }
  if (!isPlainObject(value)) throw new Error("channel message contains an unsupported value");

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > MAX_CHANNEL_OBJECT_PROPERTIES) {
    throw new Error(
      `channel object has ${keys.length} properties; limit is ${MAX_CHANNEL_OBJECT_PROPERTIES}`,
    );
  }

  for (const key of keys) {
    if (typeof key !== "string") throw new Error("channel message contains a symbol property");
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`channel message contains unsafe property ${JSON.stringify(key)}`);
    }

    const descriptor = descriptors[key];
    if (!("value" in descriptor)) throw new Error("channel message contains an accessor property");
    const propertyValue: unknown = Reflect.get(descriptor, "value");
    validateChannelValue(propertyValue, depth + 1, budget);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(value: Record<string, unknown>, key: string): void {
  if (typeof value[key] !== "string") {
    throw new Error(`channel message ${key} must be a string`);
  }
}
