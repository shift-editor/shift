import { fail } from "./error";
import {
  checkInteger,
  checkedAdd,
  Cursor,
  hex,
  MAX_I64,
  MAX_U64,
  MIN_I64,
  Writer,
} from "./layer-binary";
import {
  checkLayerDepth,
  checkLayerLimit,
  MAX_LAYER_LIB_VALUES,
  validateFinite,
} from "./layer-limits";
import { compareUtf8, DecodeState, StringPool } from "./layer-strings";
import type { LayerLibValue } from "./types";

const LIB_TAGS: Record<LayerLibValue["kind"], number> = {
  string: 0,
  integer: 1,
  "unsigned-integer": 2,
  float: 3,
  boolean: 4,
  array: 5,
  dict: 6,
  data: 7,
  date: 8,
  uid: 9,
};

export function decodeMap(
  cursor: Cursor,
  state: DecodeState,
  depth: number,
): ReadonlyMap<string, LayerLibValue> {
  checkLayerDepth(depth);
  const count = cursor.u32();
  checkLayerLimit("lib value count", checkedAdd(state.libValues, count), MAX_LAYER_LIB_VALUES);
  const values = new Map<string, LayerLibValue>();
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const keyOffset = cursor.offset;
    const key = state.requiredString(cursor.u32());
    if (previous !== null && compareUtf8(previous, key) >= 0)
      fail(
        "non-canonical-map-order",
        `dictionary keys are not in canonical UTF-8 order at byte ${keyOffset}`,
      );
    previous = key;
    values.set(key, decodeLibValue(cursor, state, depth + 1));
  }
  return values;
}

function decodeLibValue(cursor: Cursor, state: DecodeState, depth: number): LayerLibValue {
  checkLayerDepth(depth);
  state.countLibValue();
  const tagOffset = cursor.offset;
  const tag = cursor.u8();
  if (cursor.u8() !== 0 || cursor.u16() !== 0)
    fail("non-zero-reserved", `non-zero reserved lib value bytes at index ${state.libValues - 1}`);
  switch (tag) {
    case 0:
      return { kind: "string", value: state.requiredString(cursor.u32()) };
    case 1:
      return { kind: "integer", value: cursor.i64() };
    case 2:
      return { kind: "unsigned-integer", value: cursor.u64() };
    case 3: {
      const value = cursor.f64();
      validateFinite(value, "lib float", state.libValues - 1);
      return { kind: "float", value };
    }
    case 4: {
      const offset = cursor.offset;
      const value = cursor.u8();
      if (cursor.take(3).some((byte) => byte !== 0))
        fail(
          "non-zero-reserved",
          `non-zero reserved lib boolean bytes at index ${state.libValues - 1}`,
        );
      if (value !== 0 && value !== 1)
        fail("invalid-boolean", `invalid boolean ${value} at byte ${offset}`);
      return { kind: "boolean", value: value === 1 };
    }
    case 5: {
      const count = cursor.u32();
      checkLayerLimit("lib value count", checkedAdd(state.libValues, count), MAX_LAYER_LIB_VALUES);
      const value: LayerLibValue[] = [];
      for (let index = 0; index < count; index += 1)
        value.push(decodeLibValue(cursor, state, depth + 1));
      return { kind: "array", value };
    }
    case 6:
      return { kind: "dict", value: decodeMap(cursor, state, depth + 1) };
    case 7:
      return { kind: "data", value: Uint8Array.from(cursor.take(cursor.u32())) };
    case 8:
      return { kind: "date", value: state.requiredString(cursor.u32()) };
    case 9:
      return { kind: "uid", value: cursor.u64() };
    default:
      fail("unknown-lib-tag", `unknown lib value tag ${hex(tag)} at byte ${tagOffset}`);
  }
}

export function gatherMapStrings(
  values: ReadonlyMap<string, LayerLibValue>,
  strings: StringPool,
  depth: number,
  state: { count: number },
): void {
  checkLayerDepth(depth);
  for (const [key, value] of sortedEntries(values)) {
    strings.intern(key);
    gatherValueStrings(value, strings, depth + 1, state);
  }
}

function gatherValueStrings(
  value: LayerLibValue,
  strings: StringPool,
  depth: number,
  state: { count: number },
): void {
  checkLayerDepth(depth);
  state.count = checkedAdd(state.count, 1);
  checkLayerLimit("lib value count", state.count, MAX_LAYER_LIB_VALUES);
  switch (value.kind) {
    case "string":
    case "date":
      strings.intern(value.value);
      break;
    case "array":
      for (const item of value.value) gatherValueStrings(item, strings, depth + 1, state);
      break;
    case "dict":
      gatherMapStrings(value.value, strings, depth + 1, state);
      break;
  }
}

export function mapByteLength(
  values: ReadonlyMap<string, LayerLibValue>,
  depth: number,
  state: { count: number },
): number {
  checkLayerDepth(depth);
  let length = 4;
  for (const [, value] of sortedEntries(values))
    length = checkedAdd(length, checkedAdd(4, valueByteLength(value, depth + 1, state)));
  return length;
}

function valueByteLength(value: LayerLibValue, depth: number, state: { count: number }): number {
  checkLayerDepth(depth);
  state.count = checkedAdd(state.count, 1);
  checkLayerLimit("lib value count", state.count, MAX_LAYER_LIB_VALUES);
  switch (value.kind) {
    case "string":
    case "date":
      return 8;
    case "integer":
      checkInteger(value.value, MIN_I64, MAX_I64);
      return 12;
    case "unsigned-integer":
    case "uid":
      checkInteger(value.value, 0n, MAX_U64);
      return 12;
    case "float":
      validateFinite(value.value, "lib float", state.count - 1);
      return 12;
    case "boolean":
      return 8;
    case "array":
      return value.value.reduce(
        (length, item) => checkedAdd(length, valueByteLength(item, depth + 1, state)),
        8,
      );
    case "dict":
      return checkedAdd(4, mapByteLength(value.value, depth + 1, state));
    case "data":
      return checkedAdd(8, value.value.byteLength);
  }
}

export function encodeMap(
  writer: Writer,
  values: ReadonlyMap<string, LayerLibValue>,
  strings: StringPool,
  depth: number,
  state: { count: number },
): void {
  checkLayerDepth(depth);
  writer.u32(values.size);
  for (const [key, value] of sortedEntries(values)) {
    writer.u32(strings.index(key));
    encodeLibValue(writer, value, strings, depth + 1, state);
  }
}

function encodeLibValue(
  writer: Writer,
  value: LayerLibValue,
  strings: StringPool,
  depth: number,
  state: { count: number },
): void {
  checkLayerDepth(depth);
  state.count = checkedAdd(state.count, 1);
  checkLayerLimit("lib value count", state.count, MAX_LAYER_LIB_VALUES);
  writer.u8(LIB_TAGS[value.kind]);
  writer.u8(0);
  writer.u16(0);
  switch (value.kind) {
    case "string":
    case "date":
      writer.u32(strings.index(value.value));
      break;
    case "integer":
      writer.i64(value.value);
      break;
    case "unsigned-integer":
    case "uid":
      writer.u64(value.value);
      break;
    case "float":
      writer.f64(value.value);
      break;
    case "boolean":
      writer.u8(value.value ? 1 : 0);
      writer.u8(0);
      writer.u16(0);
      break;
    case "array":
      writer.u32(value.value.length);
      for (const item of value.value) encodeLibValue(writer, item, strings, depth + 1, state);
      break;
    case "dict":
      encodeMap(writer, value.value, strings, depth + 1, state);
      break;
    case "data":
      writer.u32(value.value.byteLength);
      writer.bytes(value.value);
      break;
  }
}

function sortedEntries(
  values: ReadonlyMap<string, LayerLibValue>,
): ReadonlyArray<readonly [string, LayerLibValue]> {
  return [...values.entries()].sort((left, right) => compareUtf8(left[0], right[0]));
}
