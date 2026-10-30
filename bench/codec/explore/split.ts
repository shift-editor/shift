// Encode-only vs decode-only for the kerning run and one big contour, unrolled-style vs runtime.
import { NumberReader, NumberWriter } from "../../../packages/wasm/src/numbers";
import { Reader, Writer, codec, count, list, number, option, struct, names, bool } from "../runtime";

const KerningRun = struct({ engine: count, source: option(count), location: list(number), glyphs: list(count) });
const Out = option(list(number));
const PointType = names("onCurve", "offCurve", "qCurve");
const ContourPoints = struct({ closed: bool, pointTypes: list(PointType), coordinates: list(number) });
const POINT = ["onCurve", "offCurve", "qCurve"];
const kerning = { engine: 1, source: null as number | null, location: [400, 100], glyphs: Array.from({ length: 400 }, (_, i) => (i * 37) % 1000) };
const reply = new Float64Array(202); reply[0] = 1; reply[1] = 200;
const pts = Array.from({ length: 200 }, (_, i) => (i % 4 < 2 ? "onCurve" : "offCurve"));
const contour = { closed: true, pointTypes: pts, coordinates: Array.from({ length: 400 }, (_, i) => i * 1.5) };

function uEncKern() { const w = NumberWriter.shared(); const v = kerning; w.count(v.engine); w.flag(v.source != null); if (v.source != null) w.count(v.source); w.count(v.location.length); for (const x of v.location) w.number(x); w.count(v.glyphs.length); for (const x of v.glyphs) w.count(x); return w.finish(); }
function uDecKern() { const r = new NumberReader(reply); return r.flag() ? r.list(() => r.number()) : null; }
function uEncContour() { const w = NumberWriter.shared(); const v = contour; w.flag(v.closed); w.count(v.pointTypes.length); for (const x of v.pointTypes) w.count(POINT.indexOf(x)); w.count(v.coordinates.length); for (const x of v.coordinates) w.number(x); return w.finish(); }
const kc = codec(KerningRun), oc = codec(Out), cc = codec(ContourPoints);
function pEncKern() { const w = Writer.shared(); kc.write(w, kerning); return w.finish(); }
function pDecKern() { return oc.read(new Reader(reply)); }
function pEncContour() { const w = Writer.shared(); cc.write(w, contour); return w.finish(); }

let sink = 0;
function t(name: string, fn: () => unknown) {
  for (let i = 0; i < 20000; i++) fn();
  const xs: number[] = [];
  for (let s = 0; s < 30; s++) { const t0 = performance.now(); for (let i = 0; i < 2000; i++) { const v = fn() as { length?: number }; sink += v ? 1 : 0; } xs.push(((performance.now() - t0) / 2000) * 1000); }
  xs.sort((a, b) => a - b);
  console.log(name.padEnd(14), (xs[15]! * 1000).toFixed(0), "ns");
}
t("u enc kern", uEncKern); t("p enc kern", pEncKern); t("u dec kern", uDecKern); t("p dec kern", pDecKern);
t("u enc contour", uEncContour); t("p enc contour", pEncContour);
