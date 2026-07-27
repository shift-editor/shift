import { fail } from "./error";
import type {
  GlyphLayer,
  LayerAnchor,
  LayerComponent,
  LayerContour,
  LayerGuideline,
  LayerLibValue,
  LayerPoint,
  LayerPointType,
  LayerTransform,
} from "./types";

export { GlyphCodecError } from "./error";

const MAGIC = [0x53, 0x48, 0x46, 0x54] as const;
const LAYER_KIND = 0x02;
const LAYER_VERSION = 0x01;
const HEADER_LENGTH = 72;
const NONE_STRING = 0xffff_ffff;
const CONTOUR_LENGTH = 12;
const POINT_LENGTH = 24;
const COMPONENT_LENGTH = 88;
const ANCHOR_LENGTH = 24;
const GUIDELINE_LENGTH = 40;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const MAX_U64 = (1n << 64n) - 1n;

export const MAX_LAYER_CONTOUR_COUNT = 1_000_000;
export const MAX_LAYER_POINT_COUNT = 4_000_000;
export const MAX_LAYER_ENTITY_COUNT = 1_000_000;
export const MAX_LAYER_STRING_COUNT = 4_000_000;
export const MAX_LAYER_STRING_BYTES = 64 * 1024 * 1024;
export const MAX_LAYER_LIB_VALUES = 1_000_000;
export const MAX_LAYER_LIB_DEPTH = 64;
export const MAX_LAYER_PAYLOAD_BYTES = 256 * 1024 * 1024;

type Header = {
  readonly strings: readonly string[];
  readonly stringCount: number;
  readonly contourCount: number;
  readonly pointCount: number;
  readonly componentCount: number;
  readonly anchorCount: number;
  readonly guidelineCount: number;
  readonly idIndex: number;
  readonly sourceIdIndex: number;
  readonly width: number;
  readonly height: number | null;
  readonly contoursOffset: number;
  readonly componentsOffset: number;
  readonly anchorsOffset: number;
  readonly guidelinesOffset: number;
  readonly libOffset: number;
  readonly libEnd: number;
};

/** One contour backed by validated packed bytes. */
export class LayerContourView {
  readonly #bytes: Uint8Array;
  readonly #strings: readonly string[];
  readonly #pointsOffset: number;
  readonly id: string;
  readonly closed: boolean;
  readonly pointCount: number;

  constructor(
    bytes: Uint8Array,
    strings: readonly string[],
    id: string,
    closed: boolean,
    pointCount: number,
    pointsOffset: number,
  ) {
    this.#bytes = bytes;
    this.#strings = strings;
    this.#pointsOffset = pointsOffset;
    this.id = id;
    this.closed = closed;
    this.pointCount = pointCount;
  }

  *points(): IterableIterator<LayerPoint> {
    const view = dataView(this.#bytes);
    let offset = this.#pointsOffset;
    for (let index = 0; index < this.pointCount; index += 1) {
      yield {
        id: this.#strings[view.getUint32(offset, true)],
        type: pointTypeFromByte(this.#bytes[offset + 4], index),
        smooth: (this.#bytes[offset + 5] & 1) !== 0,
        x: view.getFloat64(offset + 8, true),
        y: view.getFloat64(offset + 16, true),
      };
      offset += POINT_LENGTH;
    }
  }

  unpack(): LayerContour {
    return { id: this.id, closed: this.closed, points: [...this.points()] };
  }
}

/**
 * Opaque, immutable, validated `shift.glyph-layer.v1` bytes.
 *
 * Decoding copies caller-owned bytes. Iterators decode one authored entity at a
 * time and never construct a complete font or retain unrelated layers.
 */
export class PackedGlyphLayer {
  readonly #bytes: Uint8Array;
  readonly #header: Header;

  private constructor(bytes: Uint8Array, header: Header) {
    this.#bytes = bytes;
    this.#header = header;
  }

  static decode(data: Uint8Array): PackedGlyphLayer {
    checkLimit("payload byte length", data.byteLength, MAX_LAYER_PAYLOAD_BYTES);
    const bytes = Uint8Array.from(data);
    return new PackedGlyphLayer(bytes, validate(bytes));
  }

  static pack(layer: GlyphLayer): PackedGlyphLayer {
    const [bytes, header] = encode(layer);
    return new PackedGlyphLayer(bytes, header);
  }

  get byteLength(): number {
    return this.#bytes.byteLength;
  }

  get id(): string {
    return this.#header.strings[this.#header.idIndex];
  }

  get sourceId(): string {
    return this.#header.strings[this.#header.sourceIdIndex];
  }

  get width(): number {
    return this.#header.width;
  }

  get height(): number | null {
    return this.#header.height;
  }

  get contourCount(): number {
    return this.#header.contourCount;
  }

  get pointCount(): number {
    return this.#header.pointCount;
  }

  get componentCount(): number {
    return this.#header.componentCount;
  }

  get anchorCount(): number {
    return this.#header.anchorCount;
  }

  get guidelineCount(): number {
    return this.#header.guidelineCount;
  }

  toUint8Array(): Uint8Array {
    return this.#bytes.slice();
  }

  *contours(): IterableIterator<LayerContourView> {
    const view = dataView(this.#bytes);
    let offset = this.#header.contoursOffset;
    for (let index = 0; index < this.#header.contourCount; index += 1) {
      const pointCount = view.getUint32(offset + 4, true);
      const pointsOffset = offset + CONTOUR_LENGTH;
      yield new LayerContourView(
        this.#bytes,
        this.#header.strings,
        this.#header.strings[view.getUint32(offset, true)],
        (view.getUint32(offset + 8, true) & 1) !== 0,
        pointCount,
        pointsOffset,
      );
      offset = pointsOffset + pointCount * POINT_LENGTH;
    }
  }

  *components(): IterableIterator<LayerComponent> {
    const view = dataView(this.#bytes);
    let offset = this.#header.componentsOffset;
    for (let index = 0; index < this.#header.componentCount; index += 1) {
      yield {
        id: this.#header.strings[view.getUint32(offset, true)],
        baseGlyphId: this.#header.strings[view.getUint32(offset + 4, true)],
        baseGlyphName: this.#header.strings[view.getUint32(offset + 8, true)],
        transform: readTransform(view, offset + 16),
      };
      offset += COMPONENT_LENGTH;
    }
  }

  *anchors(): IterableIterator<LayerAnchor> {
    const view = dataView(this.#bytes);
    let offset = this.#header.anchorsOffset;
    for (let index = 0; index < this.#header.anchorCount; index += 1) {
      yield {
        id: this.#header.strings[view.getUint32(offset, true)],
        name: optionalString(this.#header.strings, view.getUint32(offset + 4, true)),
        x: view.getFloat64(offset + 8, true),
        y: view.getFloat64(offset + 16, true),
      };
      offset += ANCHOR_LENGTH;
    }
  }

  *guidelines(): IterableIterator<LayerGuideline> {
    const view = dataView(this.#bytes);
    let offset = this.#header.guidelinesOffset;
    for (let index = 0; index < this.#header.guidelineCount; index += 1) {
      const flags = view.getUint32(offset + 12, true);
      yield {
        id: this.#header.strings[view.getUint32(offset, true)],
        name: optionalString(this.#header.strings, view.getUint32(offset + 4, true)),
        color: optionalString(this.#header.strings, view.getUint32(offset + 8, true)),
        x: (flags & 1) === 0 ? null : view.getFloat64(offset + 16, true),
        y: (flags & 2) === 0 ? null : view.getFloat64(offset + 24, true),
        angle: (flags & 4) === 0 ? null : view.getFloat64(offset + 32, true),
      };
      offset += GUIDELINE_LENGTH;
    }
  }

  lib(): ReadonlyMap<string, LayerLibValue> {
    const cursor = new Cursor(this.#bytes, this.#header.libOffset, this.#header.libEnd);
    return decodeMap(cursor, new DecodeState(this.#header.strings, false), 0);
  }

  unpack(): GlyphLayer {
    return {
      id: this.id,
      sourceId: this.sourceId,
      width: this.width,
      height: this.height,
      contours: [...this.contours()].map((contour) => contour.unpack()),
      components: [...this.components()],
      anchors: [...this.anchors()],
      guidelines: [...this.guidelines()],
      lib: this.lib(),
    };
  }
}

export function packLayer(layer: GlyphLayer): PackedGlyphLayer {
  return PackedGlyphLayer.pack(layer);
}

export function decodeLayer(data: Uint8Array): PackedGlyphLayer {
  return PackedGlyphLayer.decode(data);
}

function encode(layer: GlyphLayer): readonly [Uint8Array, Header] {
  checkLimit("contour count", layer.contours.length, MAX_LAYER_CONTOUR_COUNT);
  checkLimit("component count", layer.components.length, MAX_LAYER_ENTITY_COUNT);
  checkLimit("anchor count", layer.anchors.length, MAX_LAYER_ENTITY_COUNT);
  checkLimit("guideline count", layer.guidelines.length, MAX_LAYER_ENTITY_COUNT);

  let pointCount = 0;
  for (const contour of layer.contours) {
    pointCount = checkedAdd(pointCount, contour.points.length);
    checkLimit("point count", pointCount, MAX_LAYER_POINT_COUNT);
  }

  const strings = new StringPool();
  strings.intern(layer.id);
  strings.intern(layer.sourceId);
  for (const contour of layer.contours) {
    strings.intern(contour.id);
    for (const point of contour.points) strings.intern(point.id);
  }
  for (const component of layer.components) {
    strings.intern(component.id);
    strings.intern(component.baseGlyphId);
    strings.intern(component.baseGlyphName);
  }
  for (const anchor of layer.anchors) {
    strings.intern(anchor.id);
    if (anchor.name !== null) strings.intern(anchor.name);
  }
  for (const guideline of layer.guidelines) {
    strings.intern(guideline.id);
    if (guideline.name !== null) strings.intern(guideline.name);
    if (guideline.color !== null) strings.intern(guideline.color);
  }
  const libState = { count: 0 };
  gatherMapStrings(layer.lib, strings, 0, libState);

  const libBytes = mapByteLength(layer.lib, 0, { count: 0 });
  const contoursBytes = layer.contours.reduce(
    (total, contour) =>
      checkedAdd(
        total,
        checkedAdd(CONTOUR_LENGTH, checkedMultiply(contour.points.length, POINT_LENGTH)),
      ),
    0,
  );
  const byteLength = [
    HEADER_LENGTH,
    checkedMultiply(strings.count + 1, 4),
    strings.byteLength,
    contoursBytes,
    checkedMultiply(layer.components.length, COMPONENT_LENGTH),
    checkedMultiply(layer.anchors.length, ANCHOR_LENGTH),
    checkedMultiply(layer.guidelines.length, GUIDELINE_LENGTH),
    libBytes,
  ].reduce(checkedAdd, 0);
  checkLimit("payload byte length", byteLength, MAX_LAYER_PAYLOAD_BYTES);

  const bytes = new Uint8Array(byteLength);
  const view = dataView(bytes);
  bytes.set(MAGIC, 0);
  bytes[4] = LAYER_KIND;
  bytes[5] = LAYER_VERSION;
  view.setUint16(6, 0, true);
  view.setUint32(8, byteLength, true);
  view.setUint32(12, strings.count, true);
  view.setUint32(16, strings.byteLength, true);
  view.setUint32(20, layer.contours.length, true);
  view.setUint32(24, pointCount, true);
  view.setUint32(28, layer.components.length, true);
  view.setUint32(32, layer.anchors.length, true);
  view.setUint32(36, layer.guidelines.length, true);
  view.setUint32(40, libBytes, true);
  view.setUint32(44, strings.index(layer.id), true);
  view.setUint32(48, strings.index(layer.sourceId), true);
  view.setUint32(52, layer.height === null ? 0 : 1, true);
  view.setFloat64(56, layer.width, true);
  view.setFloat64(64, layer.height ?? 0, true);

  const writer = new Writer(bytes, HEADER_LENGTH);
  writer.u32(0);
  let stringOffset = 0;
  for (const encoded of strings.encodedValues) {
    stringOffset = checkedAdd(stringOffset, encoded.byteLength);
    writer.u32(stringOffset);
  }
  for (const encoded of strings.encodedValues) writer.bytes(encoded);

  for (const contour of layer.contours) {
    writer.u32(strings.index(contour.id));
    writer.u32(contour.points.length);
    writer.u32(contour.closed ? 1 : 0);
    for (const point of contour.points) {
      writer.u32(strings.index(point.id));
      writer.u8(pointTypeByte(point.type));
      writer.u8(point.smooth ? 1 : 0);
      writer.u16(0);
      writer.f64(point.x);
      writer.f64(point.y);
    }
  }
  for (const component of layer.components) {
    writer.u32(strings.index(component.id));
    writer.u32(strings.index(component.baseGlyphId));
    writer.u32(strings.index(component.baseGlyphName));
    writer.u32(0);
    for (const value of transformValues(component.transform)) writer.f64(value);
  }
  for (const anchor of layer.anchors) {
    writer.u32(strings.index(anchor.id));
    writer.u32(anchor.name === null ? NONE_STRING : strings.index(anchor.name));
    writer.f64(anchor.x);
    writer.f64(anchor.y);
  }
  for (const guideline of layer.guidelines) {
    writer.u32(strings.index(guideline.id));
    writer.u32(guideline.name === null ? NONE_STRING : strings.index(guideline.name));
    writer.u32(guideline.color === null ? NONE_STRING : strings.index(guideline.color));
    writer.u32(
      (guideline.x === null ? 0 : 1) |
        (guideline.y === null ? 0 : 2) |
        (guideline.angle === null ? 0 : 4),
    );
    writer.f64(guideline.x ?? 0);
    writer.f64(guideline.y ?? 0);
    writer.f64(guideline.angle ?? 0);
  }
  encodeMap(writer, layer.lib, strings, 0, { count: 0 });
  if (writer.offset !== byteLength)
    fail("length-mismatch", "internal glyph-layer encoder length mismatch");

  return [bytes, validate(bytes)];
}

function validate(bytes: Uint8Array): Header {
  if (bytes.byteLength < HEADER_LENGTH) {
    fail(
      "header-truncated",
      `glyph-layer header is truncated: ${bytes.byteLength} of ${HEADER_LENGTH} bytes`,
    );
  }
  checkLimit("payload byte length", bytes.byteLength, MAX_LAYER_PAYLOAD_BYTES);
  if (MAGIC.some((byte, index) => bytes[index] !== byte))
    fail("wrong-magic", "wrong glyph-codec magic");
  if (bytes[4] !== LAYER_KIND)
    fail("unsupported-kind", `unsupported glyph-codec payload kind ${hex(bytes[4])}`);
  if (bytes[5] !== LAYER_VERSION)
    fail("unsupported-version", `unsupported glyph-layer version ${bytes[5]}`);

  const view = dataView(bytes);
  const frameFlags = view.getUint16(6, true);
  if (frameFlags !== 0)
    fail("unknown-flags", `unknown glyph-layer frame flags ${hex(frameFlags, 4)}`);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== bytes.byteLength)
    fail(
      "length-mismatch",
      `glyph-layer payload length mismatch: expected ${declaredLength} bytes, got ${bytes.byteLength}`,
    );

  const stringCount = view.getUint32(12, true);
  const stringBytes = view.getUint32(16, true);
  const contourCount = view.getUint32(20, true);
  const pointCount = view.getUint32(24, true);
  const componentCount = view.getUint32(28, true);
  const anchorCount = view.getUint32(32, true);
  const guidelineCount = view.getUint32(36, true);
  const libBytes = view.getUint32(40, true);
  const idIndex = view.getUint32(44, true);
  const sourceIdIndex = view.getUint32(48, true);
  const layerFlags = view.getUint32(52, true);
  if ((layerFlags & ~1) !== 0)
    fail("unknown-layer-flags", `unknown glyph-layer flags ${hex(layerFlags, 8)}`);
  const width = view.getFloat64(56, true);
  validateFinite(width, "width", 0);
  const rawHeight = view.getFloat64(64, true);
  const height =
    (layerFlags & 1) === 0
      ? (validateAbsent(view, 64, "height", 0), null)
      : (validateFinite(rawHeight, "height", 0), rawHeight);

  checkLimit("string count", stringCount, MAX_LAYER_STRING_COUNT);
  checkLimit("string bytes", stringBytes, MAX_LAYER_STRING_BYTES);
  checkLimit("contour count", contourCount, MAX_LAYER_CONTOUR_COUNT);
  checkLimit("point count", pointCount, MAX_LAYER_POINT_COUNT);
  checkLimit("component count", componentCount, MAX_LAYER_ENTITY_COUNT);
  checkLimit("anchor count", anchorCount, MAX_LAYER_ENTITY_COUNT);
  checkLimit("guideline count", guidelineCount, MAX_LAYER_ENTITY_COUNT);

  const offsetsBytes = checkedMultiply(checkedAdd(stringCount, 1), 4);
  const valuesOffset = checkedAdd(HEADER_LENGTH, offsetsBytes);
  const stringsEnd = checkedAdd(valuesOffset, stringBytes);
  requireRange(bytes, HEADER_LENGTH, checkedAdd(offsetsBytes, stringBytes));
  const strings = validateStrings(bytes, stringCount, stringBytes, valuesOffset);
  const state = new DecodeState(strings, true);
  state.reference(idIndex);
  state.reference(sourceIdIndex);
  const cursor = new Cursor(bytes, stringsEnd, bytes.byteLength);
  const contoursOffset = cursor.offset;
  let actualPoints = 0;
  for (let contourIndex = 0; contourIndex < contourCount; contourIndex += 1) {
    state.unique("contour", contourIndex, state.requiredString(cursor.u32()));
    const count = cursor.u32();
    actualPoints = checkedAdd(actualPoints, count);
    checkLimit("point count", actualPoints, MAX_LAYER_POINT_COUNT);
    const flags = cursor.u32();
    if ((flags & ~1) !== 0)
      fail(
        "unknown-record-flags",
        `unknown contour flags ${hex(flags, 8)} at index ${contourIndex}`,
      );
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      const pointIndex = state.pointIndex;
      state.unique("point", pointIndex, state.requiredString(cursor.u32()));
      pointTypeFromByte(cursor.u8(), pointIndex);
      const pointFlags = cursor.u8();
      if ((pointFlags & ~1) !== 0)
        fail(
          "unknown-record-flags",
          `unknown point flags ${hex(pointFlags)} at index ${pointIndex}`,
        );
      if (cursor.u16() !== 0)
        fail("non-zero-reserved", `non-zero reserved point bytes at index ${pointIndex}`);
      validateFinite(cursor.f64(), "point coordinate", pointIndex * 2);
      validateFinite(cursor.f64(), "point coordinate", pointIndex * 2 + 1);
      state.pointIndex += 1;
    }
  }
  if (actualPoints !== pointCount)
    fail(
      "point-count-mismatch",
      `contours contain ${actualPoints} points, header declares ${pointCount}`,
    );

  const componentsOffset = cursor.offset;
  for (let index = 0; index < componentCount; index += 1) {
    state.unique("component", index, state.requiredString(cursor.u32()));
    state.requiredString(cursor.u32());
    state.requiredString(cursor.u32());
    if (cursor.u32() !== 0)
      fail("non-zero-reserved", `non-zero reserved component bytes at index ${index}`);
    for (let valueIndex = 0; valueIndex < 9; valueIndex += 1)
      validateFinite(cursor.f64(), "component transform", index * 9 + valueIndex);
  }
  const anchorsOffset = cursor.offset;
  for (let index = 0; index < anchorCount; index += 1) {
    state.unique("anchor", index, state.requiredString(cursor.u32()));
    state.optionalString(cursor.u32());
    validateFinite(cursor.f64(), "anchor coordinate", index * 2);
    validateFinite(cursor.f64(), "anchor coordinate", index * 2 + 1);
  }
  const guidelinesOffset = cursor.offset;
  for (let index = 0; index < guidelineCount; index += 1) {
    state.unique("guideline", index, state.requiredString(cursor.u32()));
    state.optionalString(cursor.u32());
    state.optionalString(cursor.u32());
    const flags = cursor.u32();
    if ((flags & ~7) !== 0)
      fail("unknown-record-flags", `unknown guideline flags ${hex(flags, 8)} at index ${index}`);
    for (const [valueIndex, bit] of [1, 2, 4].entries()) {
      const offset = cursor.offset;
      const value = cursor.f64();
      if ((flags & bit) === 0)
        validateAbsent(view, offset, "guideline number", index * 3 + valueIndex);
      else validateFinite(value, "guideline number", index * 3 + valueIndex);
    }
  }
  const libOffset = cursor.offset;
  const libEnd = checkedAdd(libOffset, libBytes);
  requireRange(bytes, libOffset, libBytes);
  cursor.end = libEnd;
  decodeMap(cursor, state, 0);
  const consumedLib = cursor.offset - libOffset;
  if (consumedLib !== libBytes)
    fail(
      "lib-length-mismatch",
      `layer lib length mismatch: expected ${libBytes} bytes, consumed ${consumedLib}`,
    );
  if (libEnd !== bytes.byteLength)
    fail(
      "length-mismatch",
      `glyph-layer payload length mismatch: expected ${libEnd} bytes, got ${bytes.byteLength}`,
    );
  if (state.nextString !== stringCount)
    fail(
      "unreferenced-strings",
      `string table has unreferenced entries beginning at index ${state.nextString}`,
    );

  return {
    strings,
    stringCount,
    contourCount,
    pointCount,
    componentCount,
    anchorCount,
    guidelineCount,
    idIndex,
    sourceIdIndex,
    width,
    height,
    contoursOffset,
    componentsOffset,
    anchorsOffset,
    guidelinesOffset,
    libOffset,
    libEnd,
  };
}

class StringPool {
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

  intern(value: string): number {
    const existing = this.#indexes.get(value);
    if (existing !== undefined) return existing;
    checkLimit("string count", this.#values.length + 1, MAX_LAYER_STRING_COUNT);
    const encoded = textEncoder.encode(value);
    this.#byteLength = checkedAdd(this.#byteLength, encoded.byteLength);
    checkLimit("string bytes", this.#byteLength, MAX_LAYER_STRING_BYTES);
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

class DecodeState {
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
        "noncanonical-string-reference",
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

  unique(kind: string, index: number, value: string): void {
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
    checkLimit("lib value count", this.libValues, MAX_LAYER_LIB_VALUES);
  }
}

class Cursor {
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

class Writer {
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
    this.#view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }
  bytes(value: Uint8Array): void {
    this.#bytes.set(value, this.offset);
    this.offset += value.byteLength;
  }
}

function decodeMap(
  cursor: Cursor,
  state: DecodeState,
  depth: number,
): ReadonlyMap<string, LayerLibValue> {
  checkDepth(depth);
  const count = cursor.u32();
  checkLimit("lib value count", checkedAdd(state.libValues, count), MAX_LAYER_LIB_VALUES);
  const values = new Map<string, LayerLibValue>();
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const keyOffset = cursor.offset;
    const key = state.requiredString(cursor.u32());
    if (previous !== null && compareUtf8(previous, key) >= 0)
      fail(
        "noncanonical-map-order",
        `dictionary keys are not in canonical UTF-8 order at byte ${keyOffset}`,
      );
    previous = key;
    values.set(key, decodeLibValue(cursor, state, depth + 1));
  }
  return values;
}

function decodeLibValue(cursor: Cursor, state: DecodeState, depth: number): LayerLibValue {
  checkDepth(depth);
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
      checkLimit("lib value count", checkedAdd(state.libValues, count), MAX_LAYER_LIB_VALUES);
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

function gatherMapStrings(
  values: ReadonlyMap<string, LayerLibValue>,
  strings: StringPool,
  depth: number,
  state: { count: number },
): void {
  checkDepth(depth);
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
  checkDepth(depth);
  state.count = checkedAdd(state.count, 1);
  checkLimit("lib value count", state.count, MAX_LAYER_LIB_VALUES);
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

function mapByteLength(
  values: ReadonlyMap<string, LayerLibValue>,
  depth: number,
  state: { count: number },
): number {
  checkDepth(depth);
  let length = 4;
  for (const [, value] of sortedEntries(values))
    length = checkedAdd(length, checkedAdd(4, valueByteLength(value, depth + 1, state)));
  return length;
}

function valueByteLength(value: LayerLibValue, depth: number, state: { count: number }): number {
  checkDepth(depth);
  state.count = checkedAdd(state.count, 1);
  checkLimit("lib value count", state.count, MAX_LAYER_LIB_VALUES);
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

function encodeMap(
  writer: Writer,
  values: ReadonlyMap<string, LayerLibValue>,
  strings: StringPool,
  depth: number,
  state: { count: number },
): void {
  checkDepth(depth);
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
  checkDepth(depth);
  state.count = checkedAdd(state.count, 1);
  checkLimit("lib value count", state.count, MAX_LAYER_LIB_VALUES);
  const tags: Record<LayerLibValue["kind"], number> = {
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
  writer.u8(tags[value.kind]);
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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function validateStrings(
  bytes: Uint8Array,
  count: number,
  expectedBytes: number,
  valuesOffset: number,
): readonly string[] {
  const view = dataView(bytes);
  if (view.getUint32(HEADER_LENGTH, true) !== 0)
    fail("invalid-string-offsets", "non-canonical string offsets at index 0");
  const strings: string[] = [];
  const seen = new Set<string>();
  let previous = 0;
  for (let index = 0; index < count; index += 1) {
    const end = view.getUint32(HEADER_LENGTH + (index + 1) * 4, true);
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

function sortedEntries(
  values: ReadonlyMap<string, LayerLibValue>,
): ReadonlyArray<readonly [string, LayerLibValue]> {
  return [...values.entries()].sort((left, right) => compareUtf8(left[0], right[0]));
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const count = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < count; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function transformValues(transform: LayerTransform): readonly number[] {
  return [
    transform.translateX,
    transform.translateY,
    transform.rotation,
    transform.scaleX,
    transform.scaleY,
    transform.skewX,
    transform.skewY,
    transform.centerX,
    transform.centerY,
  ];
}

function readTransform(view: DataView, offset: number): LayerTransform {
  const values = Array.from({ length: 9 }, (_, index) => view.getFloat64(offset + index * 8, true));
  return {
    translateX: values[0],
    translateY: values[1],
    rotation: values[2],
    scaleX: values[3],
    scaleY: values[4],
    skewX: values[5],
    skewY: values[6],
    centerX: values[7],
    centerY: values[8],
  };
}

function pointTypeByte(type: LayerPointType): number {
  switch (type) {
    case "on-curve":
      return 0;
    case "off-curve":
      return 1;
    case "qcurve":
      return 2;
  }
}

function pointTypeFromByte(value: number, index: number): LayerPointType {
  switch (value) {
    case 0:
      return "on-curve";
    case 1:
      return "off-curve";
    case 2:
      return "qcurve";
    default:
      fail("unknown-point-type", `unknown point type ${hex(value)} at index ${index}`);
  }
}

function optionalString(strings: readonly string[], index: number): string | null {
  return index === NONE_STRING ? null : strings[index];
}

function validateFinite(value: number, field: string, index: number): void {
  if (!Number.isFinite(value))
    fail("non-finite-number", `non-finite ${field} value at index ${index}`);
}

function validateAbsent(view: DataView, offset: number, field: string, index: number): void {
  if (view.getBigUint64(offset, true) !== 0n)
    fail(
      "noncanonical-absent-number",
      `absent ${field} value at index ${index} is not canonical positive zero`,
    );
}

function checkInteger(value: bigint, minimum: bigint, maximum: bigint): void {
  if (value < minimum || value > maximum)
    fail("integer-out-of-range", `integer ${value} is outside the encoded range`);
}

function checkDepth(depth: number): void {
  if (depth > MAX_LAYER_LIB_DEPTH)
    fail(
      "nesting-limit-exceeded",
      `layer lib nesting exceeds implementation limit ${MAX_LAYER_LIB_DEPTH}`,
    );
}

function checkLimit(field: string, actual: number, limit: number): void {
  if (actual > limit)
    fail(
      "limit-exceeded",
      `glyph-layer ${field} exceeds implementation limit ${limit}: got ${actual}`,
    );
}

function requireRange(bytes: Uint8Array, offset: number, count: number): void {
  const end = checkedAdd(offset, count);
  if (end > bytes.byteLength)
    fail(
      "truncated",
      `glyph-layer body is truncated at byte ${offset}: need ${count} bytes, have ${Math.max(0, bytes.byteLength - offset)}`,
    );
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value))
    fail("length-overflow", "glyph-layer payload length arithmetic overflowed");
  return value;
}

function checkedMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value))
    fail("length-overflow", "glyph-layer payload length arithmetic overflowed");
  return value;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function hex(value: number, width = 2): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}
