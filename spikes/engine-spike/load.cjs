// Item 3: load a real font (serialized shift_font::Font) into the wasm engine.
const w = require("./pkg/engine_spike.js");
const fs = require("fs");
const file = process.argv[2];
let t = performance.now();
const json = fs.readFileSync(file);
const readMs = performance.now() - t;
const before = w.wasm_memory_mb();
t = performance.now();
const layer = w.engine_init_auto_bytes(json);
const loadMs = performance.now() - t;
const samples = [];
for (let i = 0; i < 6; i++) {
  const s = performance.now();
  w.engine_move_first_point(i);
  samples.push(performance.now() - s);
}
samples.shift();
console.log(JSON.stringify({
  file: file.split("/").pop(), json_mb: +(json.length / 1e6).toFixed(1), read_ms: Math.round(readMs),
  wasm_deserialize_ms: Math.round(loadMs), wasm_memory_mb_before: before, wasm_memory_mb_after: w.wasm_memory_mb(),
  edit_move_point_ms: +(samples.reduce((a, b) => a + b) / samples.length).toFixed(1), layer,
}));
