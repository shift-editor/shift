// The "emitted" variant: the same schemas as schemas.ts, still plain data, but
// each struct and unit enum carries the generator's read/write as ordinary
// source literals (no new Function). list/option/numbers/call stay the shared
// runtime helpers, which call item.read / item.write.
import { bool, call, codec, count, list, namesEmitted, number, numbers, option, struct, type Reader, type Writer } from "./runtime";
import * as bind from "./shim";

const POINT_TYPE = ["onCurve", "offCurve", "qCurve"] as const;
export const PointType = namesEmitted([...POINT_TYPE], {
  read: (r: Reader) => {
    const v = POINT_TYPE[r.count()];
    if (v === undefined) throw new Error("unknown PointType");
    return v;
  },
  write: (w: Writer, v: string) => w.count(POINT_TYPE.indexOf(v as (typeof POINT_TYPE)[number])),
});
const SEGMENT_KIND = ["line", "quad", "cubic"] as const;
export const SegmentKind = namesEmitted([...SEGMENT_KIND], {
  read: (r: Reader) => {
    const v = SEGMENT_KIND[r.count()];
    if (v === undefined) throw new Error("unknown SegmentKind");
    return v;
  },
  write: (w: Writer, v: string) => w.count(SEGMENT_KIND.indexOf(v as (typeof SEGMENT_KIND)[number])),
});

export const SegmentBounds = struct(
  { minX: number, minY: number, maxX: number, maxY: number },
  {
    read: (r) => ({ minX: r.number(), minY: r.number(), maxX: r.number(), maxY: r.number() }),
    write: (w, v) => {
      w.number(v.minX);
      w.number(v.minY);
      w.number(v.maxX);
      w.number(v.maxY);
    },
  },
);

const pointTypes = codec(list(PointType));
const numberList = codec(list(number));
const countList = codec(list(count));
const kinds = codec(list(SegmentKind));
const optionalBounds = codec(option(SegmentBounds));
const optionalCount = codec(option(count));

export const ContourPoints = struct(
  { closed: bool, pointTypes: list(PointType), coordinates: list(number) },
  {
    read: (r) => ({ closed: r.flag(), pointTypes: pointTypes.read(r), coordinates: numberList.read(r) }),
    write: (w, v) => {
      w.flag(v.closed);
      pointTypes.write(w, v.pointTypes);
      numberList.write(w, v.coordinates);
    },
  },
);
export const ContourGeometry = struct(
  { kinds: list(SegmentKind), firsts: list(count), segmentBounds: list(number), bounds: option(SegmentBounds) },
  {
    read: (r) => ({ kinds: kinds.read(r), firsts: countList.read(r), segmentBounds: numberList.read(r), bounds: optionalBounds.read(r) }),
    write: (w, v) => {
      kinds.write(w, v.kinds);
      countList.write(w, v.firsts);
      numberList.write(w, v.segmentBounds);
      optionalBounds.write(w, v.bounds);
    },
  },
);
export const DecomposedTransform = struct(
  { translateX: number, translateY: number, rotation: number, scaleX: number, scaleY: number, skewX: number, skewY: number, tCenterX: number, tCenterY: number },
  {
    read: (r) => ({
      translateX: r.number(),
      translateY: r.number(),
      rotation: r.number(),
      scaleX: r.number(),
      scaleY: r.number(),
      skewX: r.number(),
      skewY: r.number(),
      tCenterX: r.number(),
      tCenterY: r.number(),
    }),
    write: (w, v) => {
      w.number(v.translateX);
      w.number(v.translateY);
      w.number(v.rotation);
      w.number(v.scaleX);
      w.number(v.scaleY);
      w.number(v.skewX);
      w.number(v.skewY);
      w.number(v.tCenterX);
      w.number(v.tCenterY);
    },
  },
);
export const Matrix = struct(
  { a: number, b: number, c: number, d: number, e: number, f: number },
  {
    read: (r) => ({ a: r.number(), b: r.number(), c: r.number(), d: r.number(), e: r.number(), f: r.number() }),
    write: (w, v) => {
      w.number(v.a);
      w.number(v.b);
      w.number(v.c);
      w.number(v.d);
      w.number(v.e);
      w.number(v.f);
    },
  },
);
export const DragFrame = struct(
  { handle: count, dx: number, dy: number },
  {
    read: (r) => ({ handle: r.count(), dx: r.number(), dy: r.number() }),
    write: (w, v) => {
      w.count(v.handle);
      w.number(v.dx);
      w.number(v.dy);
    },
  },
);
export const DragMove = struct(
  { point: count, x: number, y: number },
  {
    read: (r) => ({ point: r.count(), x: r.number(), y: r.number() }),
    write: (w, v) => {
      w.count(v.point);
      w.number(v.x);
      w.number(v.y);
    },
  },
);
export const DragMoves = struct(
  { moves: numbers },
  {
    read: (r) => ({ moves: r.numbers() }),
    write: (w, v) => w.numbers(v.moves),
  },
);
export const KerningRun = struct(
  { engine: count, source: option(count), location: list(number), glyphs: list(count) },
  {
    read: (r) => ({ engine: r.count(), source: optionalCount.read(r), location: numberList.read(r), glyphs: countList.read(r) }),
    write: (w, v) => {
      w.count(v.engine);
      optionalCount.write(w, v.source);
      numberList.write(w, v.location);
      countList.write(w, v.glyphs);
    },
  },
);

export const contourGeometry = call<unknown, unknown>(bind.contourGeometry, ContourPoints, ContourGeometry);
export const composeTransform = call<unknown, unknown>(bind.composeTransform, DecomposedTransform, Matrix);
export const decomposeMatrix = call<unknown, unknown>(bind.decomposeMatrix, Matrix, DecomposedTransform);
export const dragMoves = call<unknown, unknown[]>(bind.dragMoves, DragFrame, list(DragMove));
export const dragMovesNumbers = call<unknown, { moves: Float64Array }>(bind.dragMoves, DragFrame, DragMoves);
export const engineKerningRun = call<unknown, unknown>(bind.engineKerningRun, KerningRun, option(list(number)));
