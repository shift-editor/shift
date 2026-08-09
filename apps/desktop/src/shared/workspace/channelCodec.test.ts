import { describe, expect, it } from "vitest";
import {
  MAX_CHANNEL_MESSAGE_BYTES,
  decodeChannelMessage,
  encodeChannelMessage,
} from "./channelCodec";

describe("channel messages preserve bounded binary state", () => {
  it("round trips Float64Array and Uint8Array values", () => {
    const source = new Float64Array([99, 1.25, -4.5, 99]);
    const encoded = encodeChannelMessage({
      kind: "request",
      id: "7",
      type: "workspace.apply",
      payload: { values: source.subarray(1, 3), bytes: Uint8Array.of(2, 4, 8) },
    });

    const decoded = decodeChannelMessage(encoded) as {
      payload: { values: Float64Array; bytes: Uint8Array };
    };
    expect(decoded.payload.values).toBeInstanceOf(Float64Array);
    expect([...decoded.payload.values]).toEqual([1.25, -4.5]);
    expect(decoded.payload.bytes).toBeInstanceOf(Uint8Array);
    expect([...decoded.payload.bytes]).toEqual([2, 4, 8]);
  });

  it("rejects messages larger than the ordinary channel frame budget", () => {
    const encoded = new Uint8Array(MAX_CHANNEL_MESSAGE_BYTES + 1);

    expect(() => decodeChannelMessage(encoded)).toThrow(`limit is ${MAX_CHANNEL_MESSAGE_BYTES}`);
  });

  it("preserves undefined channel values", () => {
    const encoded = encodeChannelMessage({
      kind: "request",
      id: "8",
      type: "workspace.create",
      payload: undefined,
    });

    const decoded = decodeChannelMessage(encoded) as { payload: unknown };
    expect(Object.hasOwn(decoded, "payload")).toBe(true);
    expect(decoded.payload).toBeUndefined();
  });

  it("rejects a declared container beyond the decode allocation limit", () => {
    const millionAndOneItems = Uint8Array.of(0xdd, 0x00, 0x0f, 0x42, 0x41);

    expect(() => decodeChannelMessage(millionAndOneItems)).toThrow("maxArrayLength");
  });

  it("rejects malformed MessagePack and unsupported channel values", () => {
    expect(() => decodeChannelMessage(Uint8Array.of(0xc1))).toThrow(
      "invalid MessagePack channel message",
    );
    expect(() =>
      encodeChannelMessage({ kind: "event", type: "bad", payload: new Map([["x", 1]]) }),
    ).toThrow("unsupported value");
  });

  it("rejects non-finite typed numeric values", () => {
    expect(() =>
      encodeChannelMessage({
        kind: "event",
        type: "workspace.changed",
        payload: new Float64Array([Number.NaN]),
      }),
    ).toThrow("non-finite Float64Array value");
  });

  it("rejects values that are not channel envelopes", () => {
    expect(() => encodeChannelMessage({ values: new Float64Array([1]) })).toThrow(
      "unknown channel message kind",
    );
  });
});
