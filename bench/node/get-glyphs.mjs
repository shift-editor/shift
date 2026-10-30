// A: today's getGlyphs through the release napi bridge, and LayerReader crossings. Throwaway.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { Bridge, LayerReader } = require("../../crates/shift-bridge/index.js");
const [doc, composites] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "bb-node-"));
const mb = (b) => (b / 1e6).toFixed(1);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)]; };
const row = (label, xs) => console.log(`| ${label} | ${q(xs, 0.5).toFixed(3)} | ${q(xs, 0.95).toFixed(3)} | ${Math.min(...xs).toFixed(3)} | ${xs.length} |`);
console.log("| Measure | median (ms) | p95 (ms) | min (ms) | n |\n|---|---|---|---|---|");
const rss0 = process.memoryUsage().rss;
const bridge = new Bridge();
let t = performance.now();
bridge.openDocument(doc, join(dir, "doc.recovery"));
const openMs = performance.now() - t;
const rssOpen = process.memoryUsage().rss;
const times = [], toJson = [];
let records, json;
for (let i = 0; i < 8; i++) {
  t = performance.now(); records = bridge.getGlyphs(); const dt = performance.now() - t;
  t = performance.now(); json = JSON.stringify(records); const dj = performance.now() - t;
  if (i > 0) { times.push(dt); toJson.push(dj); }
}
row("bridge.openDocument (once)", [openMs]);
row("bridge.getGlyphs, all records (napi objects)", times);
row("JSON.stringify of those records", toJson);
console.log(`\nrecords: ${records.length}; JSON ${mb(Buffer.byteLength(json))} MB; Node RSS before open ${mb(rss0)} MB, after open ${mb(rssOpen)} MB, after getGlyphs ${mb(process.memoryUsage().rss)} MB; V8 heap used ${mb(process.memoryUsage().heapUsed)} MB\n`);

// LayerReader crossings (what the engine's LayerSource calls from the preload), composites file.
const w = new Bridge(); w.openDocument(composites, join(dir, "c.recovery")); // the writer creates the recovery store first
const reader = LayerReader.openDocument(composites, join(dir, "c.recovery"));
const sample = records.slice(0, 5000).map((r) => r);
const layerOf = (r) => r.layers[0].id;
const bench = (label, f, n = 200) => { for (let i = 0; i < 20; i++) f(i); const xs = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); f(i); xs.push(performance.now() - t0); } row(label, xs); };
const docReader = LayerReader.openDocument(doc, join(dir, "doc.recovery"));
bench("LayerReader.loadLayers, 1 layer (napi, MessagePack bytes)", (i) => docReader.loadLayers([layerOf(sample[(i * 37) % sample.length])]));
bench("LayerReader.componentClosure, 1 glyph (napi)", (i) => reader.componentClosure([sample[(i * 37) % sample.length].id]));
bench("LayerReader.dependents, 1 layer, no dependents (napi)", (i) => reader.dependents([layerOf(sample[(i * 37) % sample.length])]));
