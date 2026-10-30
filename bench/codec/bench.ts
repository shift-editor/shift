// Schema runtime prototype vs today's unrolled generated TS, same inputs and
// replies. Bundled by build.mjs; runs in Node (bench.node.mjs) and an Electron
// renderer (bench.iife.js). Prints one JSON line per scenario, prefixed "RESULT ".
import * as geometryU from "../../packages/glyph-state/src/generated/geometryLayouts";
import * as layoutsU from "../../packages/editor/src/lib/wasm/generated/layouts";
import * as engineU from "../../packages/editor/src/lib/wasm/generated/engineLayouts";
import { NumberReader, NumberWriter } from "../../packages/wasm/src/numbers";
import * as P from "./schemas";
import * as E from "./schemasEmitted";
import * as L from "./schemasEmittedLists";
import { bindings, realBinding, realPrepareDrag, releaseDrag, useReal, type Binding, type BindingName } from "./shim";

const log = (line: string): void => console.log(line);
const env = (globalThis as { process?: { versions: Record<string, string>; argv: string[] } }).process;
const quick = env?.argv?.includes("--quick") ?? false;

// ---- inputs ---------------------------------------------------------------

/** A closed contour of `n` points (n % 4 == 0): line then cubic, repeating, on a wobbly circle. */
function contour(n: number, seed: number) {
  const pattern = ["onCurve", "onCurve", "offCurve", "offCurve"] as const;
  const pointTypes: ("onCurve" | "offCurve")[] = [];
  const coordinates: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 300 + 40 * Math.sin(a * 7 + seed);
    pointTypes.push(pattern[i % 4]!);
    coordinates.push(Math.round((500 + r * Math.cos(a)) * 100) / 100, Math.round((400 + r * Math.sin(a)) * 100) / 100);
  }
  return { closed: true, pointTypes, coordinates };
}
const glyph = (contours: number, points: number) => Array.from({ length: contours }, (_, c) => contour(points, c));

const transforms = Array.from({ length: 4 }, (_, i) => ({
  translateX: 120.5 + i * 10,
  translateY: -30 + i,
  rotation: 12.5 * i,
  scaleX: 1 + i * 0.1,
  scaleY: 0.9,
  skewX: i * 2,
  skewY: 0,
  tCenterX: 250,
  tCenterY: 350,
}));

// ---- scenarios ------------------------------------------------------------

interface Scenario {
  name: string;
  describe: string;
  bindings: BindingName[];
  /** Real module available for the full call. */
  full: boolean;
  unrolled: () => unknown;
  prototype: () => unknown;
  emitted: () => unknown;
  emittedLists: () => unknown;
  /** Compare outputs (default deep-equal). */
  same?: (u: unknown, p: unknown) => boolean;
}

// The drag: 16,700 points in 100 contours of 167, all selected, prepared once.
const DRAG_CONTOURS = 100;
const DRAG_POINTS = 167;
let dragHandle = -1;
function prepareRealDrag(): number {
  const w = new NumberWriter();
  const contours = glyph(DRAG_CONTOURS, DRAG_POINTS);
  // DragSelection: contours (closed, points{x,y,type,smooth}), selected indices.
  w.count(contours.length);
  for (const c of contours) {
    w.flag(true);
    w.count(c.pointTypes.length);
    c.pointTypes.forEach((t, i) => {
      w.number(c.coordinates[i * 2]!);
      w.number(c.coordinates[i * 2 + 1]!);
      w.count(t === "onCurve" ? 0 : 1);
      w.flag(t === "onCurve");
    });
  }
  const total = DRAG_CONTOURS * DRAG_POINTS;
  w.count(total);
  for (let i = 0; i < total; i++) w.count(i);
  const reply = new NumberReader(realPrepareDrag(w.finish()));
  return reply.count();
}

const frame = () => ({ handle: dragHandle, dx: 12.25, dy: -3.5 });

/** Generator-style unrolled code for a `struct { moves: Vec<f64> }` reply (what layout! emits for Vec<f64>). */
function unrolledDragNumbers(input: { handle: number; dx: number; dy: number }): { moves: readonly number[] } {
  const write = NumberWriter.shared();
  write.count(input.handle);
  write.number(input.dx);
  write.number(input.dy);
  const read = new NumberReader(bindings.dragMoves(write.finish()));
  return { moves: read.list(() => read.number()) };
}

const small = glyph(4, 76); // 304 points
const big = glyph(84, 200); // 16,800 points
const kerning = {
  engine: 1,
  source: null,
  location: [400, 100],
  glyphs: Array.from({ length: 400 }, (_, i) => (i * 37) % 1000),
};

const scenarios: Scenario[] = [
  {
    name: "drag-list",
    describe: "dragMoves(DragFrame{handle,dx,dy}) -> list(DragMove{point,x,y}); 16,700 moves = 50,101 reply numbers (today's shape)",
    bindings: ["dragMoves"],
    full: true,
    unrolled: () => layoutsU.dragMoves(frame()),
    prototype: () => P.dragMoves(frame()),
    emitted: () => E.dragMoves(frame()),
    emittedLists: () => L.dragMoves(frame()),
  },
  {
    name: "drag-numbers",
    describe: "same request; reply struct{moves: numbers} = count + 50,100 numbers. unrolled = generator's Vec<f64> (number[]), prototype = Float64Array view",
    bindings: ["dragMoves"],
    full: false,
    unrolled: () => unrolledDragNumbers(frame()),
    prototype: () => P.dragMovesNumbers(frame()),
    emitted: () => E.dragMovesNumbers(frame()),
    emittedLists: () => L.dragMovesNumbers(frame()),
    same: (u, p) => deepEqual((u as { moves: number[] }).moves, Array.from((p as { moves: Float64Array }).moves)),
  },
  {
    name: "geometry-small",
    describe: "contourGeometry x4 contours of 76 points (304 points: line+cubic), one frame's re-segmentation",
    bindings: ["contourGeometry"],
    full: true,
    unrolled: () => small.map((c) => geometryU.contourGeometry(c)),
    prototype: () => small.map((c) => P.contourGeometry(c)),
    emitted: () => small.map((c) => E.contourGeometry(c)),
    emittedLists: () => small.map((c) => L.contourGeometry(c)),
  },
  {
    name: "geometry-big",
    describe: "contourGeometry x84 contours of 200 points (16,800 points), one frame's re-segmentation",
    bindings: ["contourGeometry"],
    full: true,
    unrolled: () => big.map((c) => geometryU.contourGeometry(c)),
    prototype: () => big.map((c) => P.contourGeometry(c)),
    emitted: () => big.map((c) => E.contourGeometry(c)),
    emittedLists: () => big.map((c) => L.contourGeometry(c)),
  },
  {
    name: "components",
    describe: "4 components: composeTransform(DecomposedTransform)->Matrix then decomposeMatrix(Matrix)->DecomposedTransform each",
    bindings: ["composeTransform", "decomposeMatrix"],
    full: true,
    unrolled: () => transforms.map((t) => geometryU.decomposeMatrix(geometryU.composeTransform(t))),
    prototype: () => transforms.map((t) => P.decomposeMatrix(P.composeTransform(t))),
    emitted: () => transforms.map((t) => E.decomposeMatrix(E.composeTransform(t))),
    emittedLists: () => transforms.map((t) => L.decomposeMatrix(L.composeTransform(t))),
  },
  {
    name: "kerning-run",
    describe: "engineKerningRun(KerningRun{engine, source:null, location[2], glyphs[400]}) -> option(list(number))[200]; synthetic reply",
    bindings: ["engineKerningRun"],
    full: false,
    unrolled: () => engineU.engineKerningRun(kerning),
    prototype: () => P.engineKerningRun(kerning),
    emitted: () => E.engineKerningRun(kerning),
    emittedLists: () => L.engineKerningRun(kerning),
  },
];

// ---- canned replies -------------------------------------------------------

const canned = new Map<string, Float64Array[]>();

/** Records the real module's replies for one run of `fn`, in call order. */
function recordReplies(names: BindingName[], fn: () => unknown, synth?: (input: Float64Array) => Float64Array): Float64Array[] {
  const replies: Float64Array[] = [];
  for (const name of names) {
    if (synth) bindings[name] = (input) => {
      const r = synth(input);
      replies.push(r);
      return r;
    };
    else {
      useReal(name);
      const realFn = bindings[name];
      bindings[name] = (input) => {
        const r = realFn(input);
        replies.push(r);
        return r;
      };
    }
  }
  fn();
  return replies;
}

/** Sets the bindings to hand back `replies` in a cycle, and records the inputs when asked. */
function playReplies(names: BindingName[], replies: Float64Array[], inputs?: Float64Array[]): void {
  let at = 0;
  const play: Binding = (input) => {
    if (inputs) inputs.push(input.slice());
    const r = replies[at]!;
    at = at + 1 === replies.length ? 0 : at + 1;
    return r;
  };
  for (const name of names) bindings[name] = play;
}

function synthFor(name: string): ((input: Float64Array) => Float64Array) | undefined {
  if (name === "kerning-run") {
    return () => {
      const out = new Float64Array(2 + 200);
      out[0] = 1;
      out[1] = 200;
      for (let i = 0; i < 200; i++) out[2 + i] = ((i * 13) % 61) - 30;
      return out;
    };
  }
  if (name === "drag-numbers") {
    // The real drag reply with the count as numbers, not moves.
    return (input) => {
      const real = realBinding("dragMoves")(input);
      const out = real.slice();
      out[0] = real[0]! * 3;
      return out;
    };
  }
  return undefined;
}

// ---- equality -------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false; // same key order
    if (!deepEqual((a as Record<string, unknown>)[ka[i]!], (b as Record<string, unknown>)[ka[i]!])) return false;
  }
  return true;
}

function sameNumbers(a: Float64Array[], b: Float64Array[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.length !== b[i]!.length) return false;
    for (let j = 0; j < a[i]!.length; j++) if (!Object.is(a[i]![j], b[i]![j])) return false;
  }
  return true;
}

type Equality = { bytes: boolean; values: boolean; requests: number };
function checkEqual(s: Scenario, replies: Float64Array[], mode: string): { prototype: Equality; emitted: Equality; emittedLists: Equality } {
  const inU: Float64Array[] = [];
  playReplies(s.bindings, replies, inU);
  const outU = s.unrolled();
  const against = (name: string, fn: () => unknown): Equality => {
    const inX: Float64Array[] = [];
    playReplies(s.bindings, replies, inX);
    const outX = fn();
    const bytes = sameNumbers(inU, inX);
    const values = (s.same ?? deepEqual)(outU, outX);
    if (!bytes || !values) log(`EQUALITY FAILED ${s.name} ${name} ${mode} bytes=${bytes} values=${values}`);
    return { bytes, values, requests: inU.reduce((n, a) => n + a.length, 0) };
  };
  return { prototype: against("prototype", s.prototype), emitted: against("emitted", s.emitted), emittedLists: against("emittedLists", s.emittedLists) };
}

// ---- timing ---------------------------------------------------------------

let sink = 0;
const consume = (v: unknown): void => {
  sink += Array.isArray(v) ? v.length : 1;
};

function batchOf(fn: () => unknown, targetMs: number): number {
  let b = 1;
  for (;;) {
    const t0 = performance.now();
    for (let i = 0; i < b; i++) consume(fn());
    const dt = performance.now() - t0;
    if (dt >= targetMs || b >= 1 << 20) return b;
    b = dt <= 0 ? b * 8 : Math.max(b * 2, Math.ceil((b * targetMs) / dt));
  }
}

function samples(fn: () => unknown, batch: number, count: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < count; s++) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) consume(fn());
    out.push(((performance.now() - t0) / batch) * 1000); // µs per call
  }
  return out;
}

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
};

const RUNS = quick ? 3 : 7;
const SAMPLES = quick ? 15 : 50;
const TARGET_MS = (env?.versions?.electron || !env) ? 4 : 1;

function measure(s: Scenario) {
  const fns = { u: s.unrolled, p: s.prototype, e: s.emitted, l: s.emittedLists } as const;
  const keys = ["u", "p", "e", "l"] as const;
  const warm = performance.now();
  while (performance.now() - warm < (quick ? 100 : 600)) for (const k of keys) consume(fns[k]());
  const batch = { u: batchOf(fns.u, TARGET_MS), p: batchOf(fns.p, TARGET_MS), e: batchOf(fns.e, TARGET_MS), l: batchOf(fns.l, TARGET_MS) };
  const runs: Record<"u" | "p" | "e" | "l", { med: number; p95: number }>[] = [];
  for (let r = 0; r < RUNS; r++) {
    // Rotate which goes first.
    const order = [0, 1, 2, 3].map((i) => keys[(i + r) % 4]!);
    const got = {} as Record<"u" | "p" | "e" | "l", number[]>;
    for (const which of order) got[which] = samples(fns[which], batch[which], SAMPLES);
    const stat = (xs: number[]) => ({ med: quantile(xs, 0.5), p95: quantile(xs, 0.95) });
    runs.push({ u: stat(got.u), p: stat(got.p), e: stat(got.e), l: stat(got.l) });
  }
  const med = (xs: number[]) => quantile(xs, 0.5);
  const variant = (k: "u" | "p" | "e" | "l") => ({ median: med(runs.map((x) => x[k].med)), p95: med(runs.map((x) => x[k].p95)), runMedians: runs.map((x) => x[k].med), n: RUNS * SAMPLES * batch[k] });
  const ratio = (k: "p" | "e" | "l") => {
    const rs = runs.map((x) => x[k].med / x.u.med);
    return { median: med(rs), min: Math.min(...rs), max: Math.max(...rs) };
  };
  return { batch, runs: RUNS, samplesPerRun: SAMPLES, unrolled: variant("u"), prototype: variant("p"), emitted: variant("e"), emittedLists: variant("l"), ratio: { prototype: ratio("p"), emitted: ratio("e"), emittedLists: ratio("l") } };
}

// ---- main -----------------------------------------------------------------

export function main(): void {
  const where = env?.versions?.electron ? `electron ${env.versions.electron} renderer` : env ? `node ${env.versions.node}` : `browser ${navigator.userAgent}`;
  log(`ENV ${JSON.stringify({ where, ua: typeof navigator !== "undefined" ? navigator.userAgent : null })}`);
  dragHandle = prepareRealDrag();
  const only = env?.argv?.find((a) => a.startsWith("--only="))?.slice(7);
  for (const s of scenarios) {
    if (only && !only.split(",").includes(s.name)) continue;
    const replies = recordReplies(s.bindings, s.unrolled, synthFor(s.name));
    canned.set(s.name, replies);
    const replyNumbers = replies.reduce((n, a) => n + a.length, 0);

    const codecEq = checkEqual(s, replies, "codec");
    playReplies(s.bindings, replies);
    const codec = measure(s);
    log(`RESULT ${JSON.stringify({ scenario: s.name, mode: "codec-only", describe: s.describe, calls: replies.length, requestNumbers: codecEq.prototype.requests, replyNumbers, equal: codecEq, ...codec })}`);

    if (s.full) {
      for (const name of s.bindings) useReal(name);
      const outU = s.unrolled();
      const same = s.same ?? deepEqual;
      const fullEq = { prototype: same(outU, s.prototype()), emitted: same(outU, s.emitted()), emittedLists: same(outU, s.emittedLists()) };
      const full = measure(s);
      log(`RESULT ${JSON.stringify({ scenario: s.name, mode: "full-call", describe: s.describe, calls: replies.length, equal: fullEq, ...full })}`);
    }
  }
  releaseDrag(dragHandle);
  log(`DONE sink=${sink}`);
}
