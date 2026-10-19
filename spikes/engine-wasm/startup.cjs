// Spike 6: engine module startup and snapshot open, in Node's V8 (the renderer's engine).
const fs = require("fs");
const path = require("path");
const snapshot = process.argv[2];
const bytes = fs.readFileSync(path.join(__dirname, "pkg/engine_wasm_probe_bg.wasm"));
let t = performance.now();
const compiled = new WebAssembly.Module(bytes);
const compile = performance.now() - t;
t = performance.now();
const glue = require("./pkg/engine_wasm_probe.js"); // instantiates (re-compiles) synchronously
const instantiate = performance.now() - t;
const data = fs.readFileSync(snapshot);
t = performance.now();
const glyphs = glue.open_snapshot(data);
const open = performance.now() - t;
const edits = [];
for (let i = 0; i < 31; i++) {
  t = performance.now();
  glue.move_point(i);
  edits.push(performance.now() - t);
}
edits.sort((a, b) => a - b);
console.log(JSON.stringify({
  snapshot: path.basename(snapshot),
  snapshotMb: +(data.length / 1e6).toFixed(1),
  compileMs: +compile.toFixed(1),
  loadModuleMs: +instantiate.toFixed(1),
  glyphs,
  openMs: +open.toFixed(1),
  editMedianMs: +edits[15].toFixed(3),
  wasmHeapMb: glue.memory_mb(),
}));
