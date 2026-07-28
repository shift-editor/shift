import { fail } from "./error";
import { validateFinite } from "./layer-limits";

export const MIN_I64 = -(1n << 63n);
export const MAX_I64 = (1n << 63n) - 1n;
export const MAX_U64 = (1n << 64n) - 1n;

export class Cursor {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  offset: number;
  end: number;

  constructor(bytes: Uint8Array, offset: number, end: number) {
    this.#bytes = bytes;
    this.#view = dataView(bytes);
    this.offset = offset;
    this.end = end;
  }

  take(count: number): Uint8Array {
    const next = checkedAdd(this.offset, count);
    if (next > this.end)
      fail(
        "truncated",
        `glyph-layer body is truncated at byte ${this.offset}: need ${count} bytes, have ${Math.max(0, this.end - this.offset)}`,
      );
    const value = this.#bytes.subarray(this.offset, next);
    this.offset = next;
    return value;
  }

  u8(): number {
    const offset = this.offset;
    this.take(1);
    return this.#view.getUint8(offset);
  }
  u16(): number {
    const offset = this.offset;
    this.take(2);
    return this.#view.getUint16(offset, true);
  }
  u32(): number {
    const offset = this.offset;
    this.take(4);
    return this.#view.getUint32(offset, true);
  }
  i64(): bigint {
    const offset = this.offset;
    this.take(8);
    return this.#view.getBigInt64(offset, true);
  }
  u64(): bigint {
    const offset = this.offset;
    this.take(8);
    return this.#view.getBigUint64(offset, true);
  }
  f64(): number {
    const offset = this.offset;
    this.take(8);
    return this.#view.getFloat64(offset, true);
  }
}

export class Writer {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  offset: number;

  constructor(bytes: Uint8Array, offset: number) {
    this.#bytes = bytes;
    this.#view = dataView(bytes);
    this.offset = offset;
  }

  u8(value: number): void {
    this.#view.setUint8(this.offset, value);
    this.offset += 1;
  }
  u16(value: number): void {
    this.#view.setUint16(this.offset, value, true);
    this.offset += 2;
  }
  u32(value: number): void {
    this.#view.setUint32(this.offset, value, true);
    this.offset += 4;
  }
  i64(value: bigint): void {
    checkInteger(value, MIN_I64, MAX_I64);
    this.#view.setBigInt64(this.offset, value, true);
    this.offset += 8;
  }
  u64(value: bigint): void {
    checkInteger(value, 0n, MAX_U64);
    this.#view.setBigUint64(this.offset, value, true);
    this.offset += 8;
  }
  f64(value: number): void {
    validateFinite(value, "input number", 0);
    this.#view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }
  bytes(value: Uint8Array): void {
    this.#bytes.set(value, this.offset);
    this.offset += value.byteLength;
  }
}

export function checkInteger(value: bigint, minimum: bigint, maximum: bigint): void {
  if (value < minimum || value > maximum)
    fail("integer-out-of-range", `integer ${value} is outside the encoded range`);
}

export function requireRange(bytes: Uint8Array, offset: number, count: number): void {
  const end = checkedAdd(offset, count);
  if (end > bytes.byteLength)
    fail(
      "truncated",
      `glyph-layer body is truncated at byte ${offset}: need ${count} bytes, have ${Math.max(0, bytes.byteLength - offset)}`,
    );
}

export function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value))
    fail("length-overflow", "glyph-layer payload length arithmetic overflowed");
  return value;
}

export function checkedMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value))
    fail("length-overflow", "glyph-layer payload length arithmetic overflowed");
  return value;
}

export function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function hex(value: number, width = 2): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}
