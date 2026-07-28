import { fail } from "./error";
import { validateFrame, writeFrame } from "./frame";
import {
  checkedAdd,
  checkedMultiply,
  Cursor,
  dataView,
  hex,
  requireRange,
  Writer,
} from "./layer-binary";
import { decodeMap, encodeMap, gatherMapStrings, mapByteLength } from "./layer-lib";
import {
  checkLayerLimit as checkLimit,
  MAX_LAYER_CONTOUR_COUNT,
  MAX_LAYER_ENTITY_COUNT,
  MAX_LAYER_PAYLOAD_BYTES,
  MAX_LAYER_POINT_COUNT,
  MAX_LAYER_STRING_BYTES,
  MAX_LAYER_STRING_COUNT,
  validateFinite,
} from "./layer-limits";
import { DecodeState, NONE_STRING, StringPool, validateStrings } from "./layer-strings";
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
export {
  MAX_LAYER_CONTOUR_COUNT,
  MAX_LAYER_ENTITY_COUNT,
  MAX_LAYER_LIB_DEPTH,
  MAX_LAYER_LIB_VALUES,
  MAX_LAYER_PAYLOAD_BYTES,
  MAX_LAYER_POINT_COUNT,
  MAX_LAYER_STRING_BYTES,
  MAX_LAYER_STRING_COUNT,
} from "./layer-limits";

const LAYER_KIND = 0x02;
const LAYER_VERSION = 0x01;
const HEADER_LENGTH = 72;
const CONTOUR_LENGTH = 12;
const POINT_LENGTH = 24;
const COMPONENT_LENGTH = 88;
const ANCHOR_LENGTH = 24;
const GUIDELINE_LENGTH = 40;

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
  readonly #view: DataView;
  readonly #strings: readonly string[];
  readonly #pointsOffset: number;
  readonly id: string;
  readonly closed: boolean;
  readonly pointCount: number;

  constructor(
    bytes: Uint8Array,
    view: DataView,
    strings: readonly string[],
    id: string,
    closed: boolean,
    pointCount: number,
    pointsOffset: number,
  ) {
    this.#bytes = bytes;
    this.#view = view;
    this.#strings = strings;
    this.#pointsOffset = pointsOffset;
    this.id = id;
    this.closed = closed;
    this.pointCount = pointCount;
  }

  *points(): IterableIterator<LayerPoint> {
    let offset = this.#pointsOffset;
    for (let index = 0; index < this.pointCount; index += 1) {
      yield {
        id: this.#strings[this.#view.getUint32(offset, true)],
        type: pointTypeFromByte(this.#bytes[offset + 4], index),
        smooth: (this.#bytes[offset + 5] & 1) !== 0,
        x: this.#view.getFloat64(offset + 8, true),
        y: this.#view.getFloat64(offset + 16, true),
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
  readonly #view: DataView;
  readonly #header: Header;

  private constructor(bytes: Uint8Array, header: Header) {
    this.#bytes = bytes;
    this.#view = dataView(bytes);
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
    let offset = this.#header.contoursOffset;
    for (let index = 0; index < this.#header.contourCount; index += 1) {
      const pointCount = this.#view.getUint32(offset + 4, true);
      const pointsOffset = offset + CONTOUR_LENGTH;
      yield new LayerContourView(
        this.#bytes,
        this.#view,
        this.#header.strings,
        this.#header.strings[this.#view.getUint32(offset, true)],
        (this.#view.getUint32(offset + 8, true) & 1) !== 0,
        pointCount,
        pointsOffset,
      );
      offset = pointsOffset + pointCount * POINT_LENGTH;
    }
  }

  *components(): IterableIterator<LayerComponent> {
    let offset = this.#header.componentsOffset;
    for (let index = 0; index < this.#header.componentCount; index += 1) {
      yield {
        id: this.#header.strings[this.#view.getUint32(offset, true)],
        baseGlyphId: this.#header.strings[this.#view.getUint32(offset + 4, true)],
        baseGlyphName: this.#header.strings[this.#view.getUint32(offset + 8, true)],
        transform: readTransform(this.#view, offset + 16),
      };
      offset += COMPONENT_LENGTH;
    }
  }

  *anchors(): IterableIterator<LayerAnchor> {
    let offset = this.#header.anchorsOffset;
    for (let index = 0; index < this.#header.anchorCount; index += 1) {
      yield {
        id: this.#header.strings[this.#view.getUint32(offset, true)],
        name: optionalString(this.#header.strings, this.#view.getUint32(offset + 4, true)),
        x: this.#view.getFloat64(offset + 8, true),
        y: this.#view.getFloat64(offset + 16, true),
      };
      offset += ANCHOR_LENGTH;
    }
  }

  *guidelines(): IterableIterator<LayerGuideline> {
    let offset = this.#header.guidelinesOffset;
    for (let index = 0; index < this.#header.guidelineCount; index += 1) {
      const flags = this.#view.getUint32(offset + 12, true);
      yield {
        id: this.#header.strings[this.#view.getUint32(offset, true)],
        name: optionalString(this.#header.strings, this.#view.getUint32(offset + 4, true)),
        color: optionalString(this.#header.strings, this.#view.getUint32(offset + 8, true)),
        x: (flags & 1) === 0 ? null : this.#view.getFloat64(offset + 16, true),
        y: (flags & 2) === 0 ? null : this.#view.getFloat64(offset + 24, true),
        angle: (flags & 4) === 0 ? null : this.#view.getFloat64(offset + 32, true),
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
  validateLayerInput(layer);
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
  const stringOffsetsBytes = checkedMultiply(strings.count + 1, 4);
  const contoursOffset = checkedAdd(
    checkedAdd(HEADER_LENGTH, stringOffsetsBytes),
    strings.byteLength,
  );
  const componentsOffset = checkedAdd(contoursOffset, contoursBytes);
  const anchorsOffset = checkedAdd(
    componentsOffset,
    checkedMultiply(layer.components.length, COMPONENT_LENGTH),
  );
  const guidelinesOffset = checkedAdd(
    anchorsOffset,
    checkedMultiply(layer.anchors.length, ANCHOR_LENGTH),
  );
  const libOffset = checkedAdd(
    guidelinesOffset,
    checkedMultiply(layer.guidelines.length, GUIDELINE_LENGTH),
  );
  const byteLength = checkedAdd(libOffset, libBytes);
  checkLimit("payload byte length", byteLength, MAX_LAYER_PAYLOAD_BYTES);

  const bytes = new Uint8Array(byteLength);
  const view = dataView(bytes);
  writeFrame(bytes, LAYER_KIND, LAYER_VERSION);
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

  return [
    bytes,
    {
      strings: strings.values,
      stringCount: strings.count,
      contourCount: layer.contours.length,
      pointCount,
      componentCount: layer.components.length,
      anchorCount: layer.anchors.length,
      guidelineCount: layer.guidelines.length,
      idIndex: strings.index(layer.id),
      sourceIdIndex: strings.index(layer.sourceId),
      width: layer.width,
      height: layer.height,
      contoursOffset,
      componentsOffset,
      anchorsOffset,
      guidelinesOffset,
      libOffset,
      libEnd: byteLength,
    },
  ];
}

function validateLayerInput(layer: GlyphLayer): void {
  validateFinite(layer.width, "width", 0);
  if (layer.height !== null) validateFinite(layer.height, "height", 0);

  const identities = new Map<string, Set<string>>();
  const unique = (kind: string, index: number, id: string): void => {
    let values = identities.get(kind);
    if (!values) {
      values = new Set();
      identities.set(kind, values);
    }
    if (values.has(id)) fail("duplicate-identity", `duplicate ${kind} identity at index ${index}`);
    values.add(id);
  };

  let pointIndex = 0;
  for (const [contourIndex, contour] of layer.contours.entries()) {
    unique("contour", contourIndex, contour.id);
    for (const point of contour.points) {
      unique("point", pointIndex, point.id);
      pointIndex += 1;
    }
  }
  for (const [index, component] of layer.components.entries())
    unique("component", index, component.id);
  for (const [index, anchor] of layer.anchors.entries()) unique("anchor", index, anchor.id);
  for (const [index, guideline] of layer.guidelines.entries())
    unique("guideline", index, guideline.id);
}

function validate(bytes: Uint8Array): Header {
  validateFrame(bytes, {
    headerLength: HEADER_LENGTH,
    kind: LAYER_KIND,
    version: LAYER_VERSION,
    headerName: "glyph-layer",
    versionName: "glyph-layer",
    flagsName: "glyph-layer frame",
  });
  checkLimit("payload byte length", bytes.byteLength, MAX_LAYER_PAYLOAD_BYTES);

  const view = dataView(bytes);
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
  const strings = validateStrings(bytes, stringCount, stringBytes, HEADER_LENGTH, valuesOffset);
  const state = new DecodeState(strings, true);
  state.reference(idIndex);
  state.reference(sourceIdIndex);
  const cursor = new Cursor(bytes, stringsEnd, bytes.byteLength);
  const contoursOffset = cursor.offset;
  let actualPoints = 0;
  for (let contourIndex = 0; contourIndex < contourCount; contourIndex += 1) {
    state.uniqueIdentity("contour", contourIndex, state.requiredString(cursor.u32()));
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
      state.uniqueIdentity("point", pointIndex, state.requiredString(cursor.u32()));
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
    state.uniqueIdentity("component", index, state.requiredString(cursor.u32()));
    state.requiredString(cursor.u32());
    state.requiredString(cursor.u32());
    if (cursor.u32() !== 0)
      fail("non-zero-reserved", `non-zero reserved component bytes at index ${index}`);
    for (let valueIndex = 0; valueIndex < 9; valueIndex += 1)
      validateFinite(cursor.f64(), "component transform", index * 9 + valueIndex);
  }
  const anchorsOffset = cursor.offset;
  for (let index = 0; index < anchorCount; index += 1) {
    state.uniqueIdentity("anchor", index, state.requiredString(cursor.u32()));
    state.optionalString(cursor.u32());
    validateFinite(cursor.f64(), "anchor coordinate", index * 2);
    validateFinite(cursor.f64(), "anchor coordinate", index * 2 + 1);
  }
  const guidelinesOffset = cursor.offset;
  for (let index = 0; index < guidelineCount; index += 1) {
    state.uniqueIdentity("guideline", index, state.requiredString(cursor.u32()));
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
    default:
      fail("unknown-point-type", `unknown input point type ${String(type)}`);
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

function validateAbsent(view: DataView, offset: number, field: string, index: number): void {
  if (view.getBigUint64(offset, true) !== 0n)
    fail(
      "non-canonical-absent-number",
      `absent ${field} value at index ${index} is not canonical positive zero`,
    );
}
