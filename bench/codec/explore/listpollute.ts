// Is the kerning gap in list(number) reads/writes, and does it come from the shared
// list helper seeing other lists? Measure encode and decode separately, before and after
// running the same helpers over the other lists the bench uses.
import { NumberReader, NumberWriter } from "../../../packages/wasm/src/numbers";
import { Reader, Writer, codec, count, list, number, option, struct } from "../runtime";

const KerningRun = struct({ engine: count, source: option(count), location: list(number), glyphs: list(count) });
const kc = codec(KerningRun), oc = codec(option(list(number)));
const kerning = { engine: 1, source: null as number | null, location: [400, 100], glyphs: Array.from({ length: 400 }, (_, i) => (i * 37) % 1000) };
const reply = new Float64Array(202); reply[0] = 1; reply[1] = 200; for (let i = 0; i < 200; i++) reply[2 + i] = ((i * 13) % 61) - 30;
// other lists as the geometry calls produce them: fractional coordinates, counts, bounds
const coords = new Float64Array(401); coords[0] = 400; for (let i = 0; i < 400; i++) coords[1 + i] = 500 + Math.sin(i) * 300;
const counts = new Float64Array(101); counts[0] = 100; for (let i = 0; i < 100; i++) counts[1 + i] = i * 2;
const coordArray = Array.from({ length: 400 }, (_, i) => 500 + Math.sin(i) * 300);

function uEnc() { const w = NumberWriter.shared(); const v = kerning; w.count(v.engine); w.flag(v.source != null); if (v.source != null) w.count(v.source); w.count(v.location.length); for (const x of v.location) w.number(x); w.count(v.glyphs.length); for (const x of v.glyphs) w.count(x); return w.finish(); }
function uDec() { const r = new NumberReader(reply); return r.flag() ? r.list(() => r.number()) : null; }
function pEnc() { const w = Writer.shared(); kc.write(w, kerning); return w.finish(); }
function pDec() { return oc.read(new Reader(reply)); }

let sink = 0;
function t(name: string, fn: () => unknown) {
  for (let i = 0; i < 20000; i++) fn();
  const xs: number[] = [];
  for (let s = 0; s < 30; s++) { const t0 = performance.now(); for (let i = 0; i < 2000; i++) sink += fn() ? 1 : 0; xs.push(((performance.now() - t0) / 2000) * 1e6); }
  xs.sort((a, b) => a - b);
  return Math.round(xs[15]!);
}
const row = (label: string) => console.log(label.padEnd(10), JSON.stringify({ uEnc: t("", uEnc), pEnc: t("", pEnc), uDec: t("", uDec), pDec: t("", pDec) }), "ns");
row("clean");
// Pollute: the same list(number)/list(count) helpers (and NumberReader.list) over the geometry-shaped lists.
const ln = codec(list(number)), lc = codec(list(count));
const which = process.argv[2] ?? "all";
for (let i = 0; i < 20000; i++) {
  if (which === "all" || which === "reads") { ln.read(new Reader(coords)); lc.read(new Reader(counts)); }
  if (which === "all" || which === "writeDouble") { const w = Writer.shared(); ln.write(w, coordArray); }
  if (which === "all" || which === "writeSmall") { const w = Writer.shared(); lc.write(w, [1, 2, 3]); }
  if (which === "all" || which === "writeTyped") { const w = Writer.shared(); ln.write(w, coords); }
}
row("polluted:" + which);
