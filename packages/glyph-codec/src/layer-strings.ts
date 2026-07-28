import { fail } from "./error";
import { checkedAdd, dataView } from "./layer-binary";
import {
  checkLayerLimit,
  MAX_LAYER_LIB_VALUES,
  MAX_LAYER_STRING_BYTES,
  MAX_LAYER_STRING_COUNT,
} from "./layer-limits";

export const NONE_STRING = 0xffff_ffff;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export class StringPool {
  readonly #indexes = new Map<string, number>();
  readonly #values: string[] = [];
  readonly #encoded: Uint8Array[] = [];
  #byteLength = 0;

  get count(): number {
    return this.#values.length;
  }
  get byteLength(): number {
    return this.#byteLength;
  }
  get encodedValues(): readonly Uint8Array[] {
    return this.#encoded;
  }
  get values(): readonly string[] {
    return this.#values;
  }

  intern(value: string): number {
    const existing = this.#indexes.get(value);
    if (existing !== undefined) return existing;
    checkLayerLimit("string count", this.#values.length + 1, MAX_LAYER_STRING_COUNT);
    const encoded = textEncoder.encode(value);
    if (textDecoder.decode(encoded) !== value)
      fail("invalid-utf8", "input string is not valid Unicode scalar text");
    this.#byteLength = checkedAdd(this.#byteLength, encoded.byteLength);
    checkLayerLimit("string bytes", this.#byteLength, MAX_LAYER_STRING_BYTES);
    const index = this.#values.length;
    this.#values.push(value);
    this.#encoded.push(encoded);
    this.#indexes.set(value, index);
    return index;
  }

  index(value: string): number {
    const index = this.#indexes.get(value);
    if (index === undefined) throw new Error("strings must be gathered before encoding");
    return index;
  }
}

export class DecodeState {
  readonly #strings: readonly string[];
  readonly #validateReferences: boolean;
  readonly #identities = new Map<string, Set<string>>();
  nextString = 0;
  pointIndex = 0;
  libValues = 0;

  constructor(strings: readonly string[], validateReferences: boolean) {
    this.#strings = strings;
    this.#validateReferences = validateReferences;
  }

  reference(index: number): void {
    if (index >= this.#strings.length)
      fail("string-reference-out-of-range", `string reference ${index} is out of range`);
    if (!this.#validateReferences) return;
    if (index > this.nextString)
      fail(
        "non-canonical-string-reference",
        `string reference ${index} is out of canonical first-use order; expected at most ${this.nextString}`,
      );
    if (index === this.nextString) this.nextString += 1;
  }

  requiredString(index: number): string {
    this.reference(index);
    return this.#strings[index];
  }

  optionalString(index: number): string | null {
    return index === NONE_STRING ? null : this.requiredString(index);
  }

  uniqueIdentity(kind: string, index: number, value: string): void {
    let identities = this.#identities.get(kind);
    if (!identities) {
      identities = new Set();
      this.#identities.set(kind, identities);
    }
    if (identities.has(value))
      fail("duplicate-identity", `duplicate ${kind} identity at index ${index}`);
    identities.add(value);
  }

  countLibValue(): void {
    this.libValues = checkedAdd(this.libValues, 1);
    checkLayerLimit("lib value count", this.libValues, MAX_LAYER_LIB_VALUES);
  }
}

export function validateStrings(
  bytes: Uint8Array,
  count: number,
  expectedBytes: number,
  offsetsOffset: number,
  valuesOffset: number,
): readonly string[] {
  const view = dataView(bytes);
  if (view.getUint32(offsetsOffset, true) !== 0)
    fail("invalid-string-offsets", "non-canonical string offsets at index 0");
  const strings: string[] = [];
  const seen = new Set<string>();
  let previous = 0;
  for (let index = 0; index < count; index += 1) {
    const end = view.getUint32(offsetsOffset + (index + 1) * 4, true);
    if (end < previous || end > expectedBytes)
      fail("invalid-string-offsets", `non-canonical string offsets at index ${index + 1}`);
    let value: string;
    try {
      value = textDecoder.decode(bytes.subarray(valuesOffset + previous, valuesOffset + end));
    } catch {
      fail("invalid-utf8", `invalid UTF-8 in string ${index}`);
    }
    if (seen.has(value)) fail("duplicate-string", `duplicate string-table value at index ${index}`);
    seen.add(value);
    strings.push(value);
    previous = end;
  }
  if (previous !== expectedBytes)
    fail("invalid-string-offsets", `non-canonical string offsets at index ${count}`);
  return strings;
}

export function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const count = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < count; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}
