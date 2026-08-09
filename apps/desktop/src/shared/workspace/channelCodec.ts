import { Decoder, Encoder, ExtensionCodec } from "@msgpack/msgpack";

/** Maximum encoded size of one ordinary channel request, response, event, or close frame. */
export const MAX_CHANNEL_MESSAGE_BYTES = 32 * 1024 * 1024;

const MAX_CHANNEL_ARRAY_LENGTH = 1_000_000;
const MAX_CHANNEL_OBJECT_PROPERTIES = 100_000;
const MAX_CHANNEL_VALUE_DEPTH = 64;
const MAX_CHANNEL_VALUE_COUNT = 2_000_000;
const FLOAT64_ARRAY_EXTENSION_TYPE = 1;
const UNDEFINED_EXTENSION_TYPE = 2;
const UNDEFINED_EXTENSION_VALUE = Object.freeze({});
const EMPTY_EXTENSION_BYTES = new Uint8Array();

// MessagePack binary values preserve Uint8Array directly. These two explicit
// extension codes preserve the remaining structured-clone values in Shift's
// channel contract and can be implemented by a future rmp-serde peer.
const extensionCodec = new ExtensionCodec();
extensionCodec.register({
  type: FLOAT64_ARRAY_EXTENSION_TYPE,
  encode: encodeFloat64Array,
  decode: decodeFloat64Array,
});
extensionCodec.register({
  type: UNDEFINED_EXTENSION_TYPE,
  encode: (value) => (value === UNDEFINED_EXTENSION_VALUE ? EMPTY_EXTENSION_BYTES : null),
  decode: (bytes) => {
    if (bytes.byteLength !== 0) throw new Error("invalid undefined extension");

    return undefined;
  },
});

const encoder = new Encoder({
  extensionCodec,
  maxDepth: MAX_CHANNEL_VALUE_DEPTH,
});
const decoder = new Decoder({
  extensionCodec,
  maxStrLength: MAX_CHANNEL_MESSAGE_BYTES,
  maxBinLength: MAX_CHANNEL_MESSAGE_BYTES,
  maxArrayLength: MAX_CHANNEL_ARRAY_LENGTH,
  maxMapLength: MAX_CHANNEL_OBJECT_PROPERTIES,
  maxExtLength: MAX_CHANNEL_MESSAGE_BYTES,
  mapKeyConverter: decodeMapKey,
});

/** Encodes one bounded channel envelope while preserving supported typed arrays. */
export function encodeChannelMessage(message: unknown): Uint8Array<ArrayBuffer> {
  validateChannelMessage(message);
  const encoded = encoder.encode(replaceUndefined(message));
  if (encoded.byteLength > MAX_CHANNEL_MESSAGE_BYTES) {
    throw new Error(
      `channel message has ${encoded.byteLength} bytes; limit is ${MAX_CHANNEL_MESSAGE_BYTES}`,
    );
  }

  return encoded;
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
    throw new Error(`invalid MessagePack channel message: ${detail}`);
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

function encodeFloat64Array(value: unknown): Uint8Array | null {
  if (!(value instanceof Float64Array)) return null;

  const bytes = new Uint8Array(value.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setFloat64(index * Float64Array.BYTES_PER_ELEMENT, value[index]!, true);
  }
  return bytes;
}

function decodeFloat64Array(bytes: Uint8Array): Float64Array {
  if (bytes.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("invalid Float64Array extension length");
  }

  const result = new Float64Array(bytes.byteLength / Float64Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getFloat64(index * Float64Array.BYTES_PER_ELEMENT, true);
  }
  return result;
}

function decodeMapKey(key: unknown): string {
  if (typeof key !== "string") throw new Error("channel map keys must be strings");
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    throw new Error(`channel message contains unsafe property ${JSON.stringify(key)}`);
  }

  return key;
}

function replaceUndefined(value: unknown): unknown {
  if (value === undefined) return UNDEFINED_EXTENSION_VALUE;
  if (Array.isArray(value)) return value.map(replaceUndefined);
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, propertyValue] of Object.entries(value)) {
    result[key] = replaceUndefined(propertyValue);
  }
  return result;
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
