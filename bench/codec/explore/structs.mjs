// Microbench: ways to read list(struct{point,x,y}) from 16,700 triples without eval.
class Reader { #v; #at = 0; constructor(v) { this.#v = v; } number() { return this.#v[this.#at++] ?? 0; } count() { return Math.max(0, this.number()); } }
const N = 16700; const buf = new Float64Array(1 + 3 * N); buf[0] = N; for (let i = 0; i < N; i++) { buf[1+3*i] = i; buf[2+3*i] = i*1.5; buf[3+3*i] = -i; }
const NUMBER = { read: (r) => r.number() }, COUNT = { read: (r) => r.count() };
const fields = { point: COUNT, x: NUMBER, y: NUMBER };
// Other struct shapes so shared closure sites see many schemas (as in a real app).
const others = [{ q: NUMBER, w: COUNT, e: NUMBER }, { sourceIndex: COUNT, xx: NUMBER, yy: NUMBER }, { a: NUMBER, b: NUMBER, c: NUMBER, d: NUMBER, e: NUMBER, f: NUMBER }, { minX: NUMBER, minY: NUMBER, maxX: NUMBER, maxY: NUMBER }, { translateX: NUMBER, translateY: NUMBER, rotation: NUMBER, scaleX: NUMBER, scaleY: NUMBER, skewX: NUMBER, skewY: NUMBER, tCenterX: NUMBER, tCenterY: NUMBER }, { position: NUMBER, overshoot: NUMBER }];
const ob = new Float64Array(64).fill(1);

function A(f) { const keys = Object.keys(f), parts = keys.map(k => f[k]), n = keys.length; return { read: (r) => { const o = {}; for (let i = 0; i < n; i++) o[keys[i]] = parts[i].read(r); return o; } }; }
function C(f) { const keys = Object.keys(f), parts = keys.map(k => f[k]), n = keys.length; const tpl = {}; for (const k of keys) tpl[k] = 0; return { read: (r) => { const o = { ...tpl }; for (let i = 0; i < n; i++) o[keys[i]] = parts[i].read(r); return o; } }; }
// D: scalar-only structs read numbers directly by kind code (no per-field closure call).
function D(f) { const keys = Object.keys(f), n = keys.length; const clamp = keys.map(k => f[k] === COUNT); const tpl = {}; for (const k of keys) tpl[k] = 0; return { read: (r) => { const o = { ...tpl }; for (let i = 0; i < n; i++) { const v = r.number(); o[keys[i]] = clamp[i] ? Math.max(0, v) : v; } return o; } }; }
// E: arity-specialised closures, fixed keys captured.
function E(f) { const keys = Object.keys(f), p = keys.map(k => f[k].read); if (keys.length === 3) { const [k0,k1,k2] = keys, [r0,r1,r2] = p; return { read: (r) => { const o = {}; o[k0] = r0(r); o[k1] = r1(r); o[k2] = r2(r); return o; } }; } return A(f); }
const unrolled = (r) => ({ point: r.count(), x: r.number(), y: r.number() });
function listOf(item) { return (r) => { const n = r.count(), items = []; for (let i = 0; i < n; i++) items.push(item.read(r)); return items; }; }
function F(f) { const keys = Object.keys(f), p = keys.map(k => f[k].read); if (keys.length === 3) { const [k0,k1,k2] = keys, [r0,r1,r2] = p; return { read: (r) => ({ [k0]: r0(r), [k1]: r1(r), [k2]: r2(r) }) }; } return A(f); }
// G: arity-specialised, and each field is a kind code read inline (scalars), not a closure call.
function G(f) { const keys = Object.keys(f); const read = (s) => s === COUNT ? 1 : s === NUMBER ? 0 : 2; if (keys.length === 3) { const [k0,k1,k2] = keys; const [c0,c1,c2] = keys.map(k => read(f[k])); const one = (r, c) => c === 0 ? r.number() : r.count(); return { read: (r) => { const o = {}; o[k0] = one(r, c0); o[k1] = one(r, c1); o[k2] = one(r, c2); return o; } }; } return A(f); }
// H: the schema carries a per-type constructor literal emitted by the generator, e.g.
// struct({point: count, x: number, y: number}, (point, x, y) => ({ point, x, y })).
// Each literal has its own feedback, so object creation stays monomorphic.
const makers = new Map();
function makerFor(f) { const keys = Object.keys(f).join(","); if (!makers.has(keys)) makers.set(keys, new Function(...Object.keys(f), "return {" + Object.keys(f).join(",") + "}")); return makers.get(keys); } // stands in for the generator's emitted literal (bench only)
function H(f) { const keys = Object.keys(f), p = keys.map(k => f[k].read), make = makerFor(f); if (keys.length === 3) { const [r0,r1,r2] = p; return { read: (r) => make(r0(r), r1(r), r2(r)) }; } if (keys.length === 4) { const [r0,r1,r2,r3] = p; return { read: (r) => make(r0(r), r1(r), r2(r), r3(r)) }; } const n = keys.length; return { read: (r) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = p[i](r); return make(...a); } }; }
const scalar = (r, c) => (c === 0 ? r.number() : r.count());
function H2(f) { const keys = Object.keys(f), make = makerFor(f); const cs = keys.map(k => f[k] === COUNT ? 1 : f[k] === NUMBER ? 0 : -1); if (keys.length === 3 && !cs.includes(-1)) { const [c0,c1,c2] = cs; return { read: (r) => make(scalar(r, c0), scalar(r, c1), scalar(r, c2)) }; } return H(f); }
const strategies = { A, H, H2 };
const results = {};
const timed = (name, fn) => { for (let w = 0; w < 50; w++) fn(); const xs = []; for (let s = 0; s < 60; s++) { const t = performance.now(); fn(); xs.push((performance.now() - t) * 1000); } xs.sort((a,b)=>a-b); results[name] = xs[30].toFixed(1); };
timed("unrolled", () => { const r = new Reader(buf); const n = r.count(), items = []; for (let i = 0; i < n; i++) items.push(unrolled(r)); return items; });
for (const [name, make] of Object.entries(strategies)) {
  // Pollute the shared sites with other shapes first, as a real app would.
  for (const o of others) { const c = make(o); for (let i = 0; i < 2000; i++) c.read(new Reader(ob)); }
  const list = listOf(make(fields));
  timed(name, () => list(new Reader(buf)));
}
console.log(JSON.stringify(results));
