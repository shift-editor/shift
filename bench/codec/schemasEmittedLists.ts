// The "emitted-lists" variant: as schemasEmitted.ts, but list and option reads
// and writes are emitted inline in the parent's literal through typed Reader /
// Writer methods (numberList, counts, list(readX)), and options inline as
// `r.flag() ? … : null`. Only `call` stays a shared helper; the reply's
// top-level list/option is a schema whose emitted codec is written here too.
import { bool, call, count, list, names, number, numbers, option, struct, type Codec, type Reader, type Writer } from "./runtime";
import * as bind from "./shim";

const POINT_TYPE = ["onCurve", "offCurve", "qCurve"] as const;
const SEGMENT_KIND = ["line", "quad", "cubic"] as const;
function readPointType(r: Reader): string {
  const v = POINT_TYPE[r.count()];
  if (v === undefined) throw new Error("unknown PointType");
  return v;
}
function writePointType(w: Writer, v: string): void {
  w.count(POINT_TYPE.indexOf(v as (typeof POINT_TYPE)[number]));
}
function readSegmentKind(r: Reader): string {
  const v = SEGMENT_KIND[r.count()];
  if (v === undefined) throw new Error("unknown SegmentKind");
  return v;
}
function writeSegmentKind(w: Writer, v: string): void {
  w.count(SEGMENT_KIND.indexOf(v as (typeof SEGMENT_KIND)[number]));
}
function readSegmentBounds(r: Reader) {
  return { minX: r.number(), minY: r.number(), maxX: r.number(), maxY: r.number() };
}
function writeSegmentBounds(w: Writer, v: { minX: number; minY: number; maxX: number; maxY: number }): void {
  w.number(v.minX);
  w.number(v.minY);
  w.number(v.maxX);
  w.number(v.maxY);
}
function readDragMove(r: Reader) {
  return { point: r.count(), x: r.number(), y: r.number() };
}
function writeDragMove(w: Writer, v: { point: number; x: number; y: number }): void {
  w.count(v.point);
  w.number(v.x);
  w.number(v.y);
}

/** A schema whose codec is the given emitted literal. */
const withCodec = <S extends object>(schema: S, emitted: Codec): S => ({ ...schema, emitted }) as S;

export const PointType = withCodec(names(...POINT_TYPE), { read: readPointType, write: writePointType });
export const SegmentKind = withCodec(names(...SEGMENT_KIND), { read: readSegmentKind, write: writeSegmentKind });
export const SegmentBounds = struct({ minX: number, minY: number, maxX: number, maxY: number }, { read: readSegmentBounds, write: writeSegmentBounds });
export const ContourPoints = struct(
  { closed: bool, pointTypes: list(PointType), coordinates: list(number) },
  {
    read: (r) => ({ closed: r.flag(), pointTypes: r.list(readPointType), coordinates: r.numberList() }),
    write: (w, v) => {
      w.flag(v.closed);
      w.list(v.pointTypes, writePointType);
      w.numberList(v.coordinates);
    },
  },
);
export const ContourGeometry = struct(
  { kinds: list(SegmentKind), firsts: list(count), segmentBounds: list(number), bounds: option(SegmentBounds) },
  {
    read: (r) => ({
      kinds: r.list(readSegmentKind),
      firsts: r.counts(),
      segmentBounds: r.numberList(),
      bounds: r.flag() ? readSegmentBounds(r) : null,
    }),
    write: (w, v) => {
      w.list(v.kinds, writeSegmentKind);
      w.counts(v.firsts);
      w.numberList(v.segmentBounds);
      if (v.bounds != null) {
        w.flag(true);
        writeSegmentBounds(w, v.bounds);
      } else w.flag(false);
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
export const DragMove = struct({ point: count, x: number, y: number }, { read: readDragMove, write: writeDragMove });
export const DragMoveList = withCodec(list(DragMove), {
  read: (r) => r.list(readDragMove),
  write: (w, v) => w.list(v, writeDragMove),
});
export const DragMoves = struct({ moves: numbers }, { read: (r) => ({ moves: r.numbers() }), write: (w, v) => w.numbers(v.moves) });
export const KerningRun = struct(
  { engine: count, source: option(count), location: list(number), glyphs: list(count) },
  {
    read: (r) => ({ engine: r.count(), source: r.flag() ? r.count() : null, location: r.numberList(), glyphs: r.counts() }),
    write: (w, v) => {
      w.count(v.engine);
      if (v.source != null) {
        w.flag(true);
        w.count(v.source);
      } else w.flag(false);
      w.numberList(v.location);
      w.counts(v.glyphs);
    },
  },
);
export const KerningValues = withCodec(option(list(number)), {
  read: (r) => (r.flag() ? r.numberList() : null),
  write: (w, v) => {
    if (v != null) {
      w.flag(true);
      w.numberList(v);
    } else w.flag(false);
  },
});

export const contourGeometry = call<unknown, unknown>(bind.contourGeometry, ContourPoints, ContourGeometry);
export const composeTransform = call<unknown, unknown>(bind.composeTransform, DecomposedTransform, Matrix);
export const decomposeMatrix = call<unknown, unknown>(bind.decomposeMatrix, Matrix, DecomposedTransform);
export const dragMoves = call<unknown, unknown[]>(bind.dragMoves, DragFrame, DragMoveList);
export const dragMovesNumbers = call<unknown, { moves: Float64Array }>(bind.dragMoves, DragFrame, DragMoves);
export const engineKerningRun = call<unknown, unknown>(bind.engineKerningRun, KerningRun, KerningValues);
