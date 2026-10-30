// Shared write loop over arrays of different elements kinds (SMI vs DOUBLE): for...of vs indexed.
class W { #v = new Float64Array(4096); #n = 0; reset() { this.#n = 0; } number(x) { this.#v[this.#n++] = x; } }
const w = new W();
const forOf = (items) => { w.number(items.length); for (const x of items) w.number(x); };
const indexed = (items) => { const n = items.length; w.number(n); for (let i = 0; i < n; i++) w.number(items[i]); };
const smi = Array.from({ length: 400 }, (_, i) => (i * 37) % 1000), dbl = Array.from({ length: 400 }, (_, i) => 500 + Math.sin(i) * 300);
const t = (fn) => { for (let i = 0; i < 20000; i++) { w.reset(); fn(smi); } const xs = []; for (let s = 0; s < 30; s++) { const t0 = performance.now(); for (let i = 0; i < 2000; i++) { w.reset(); fn(smi); } xs.push((performance.now() - t0) / 2000 * 1e6); } xs.sort((a, b) => a - b); return Math.round(xs[15]); };
const out = { forOfClean: t(forOf), indexedClean: t(indexed) };
for (let i = 0; i < 20000; i++) { w.reset(); forOf(dbl); w.reset(); indexed(dbl); }
Object.assign(out, { forOfPolluted: t(forOf), indexedPolluted: t(indexed) });
console.log(JSON.stringify(out), "ns per 400-item write");
