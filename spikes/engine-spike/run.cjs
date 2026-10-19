const w = require("./pkg/engine_spike.js");
const which = process.argv.slice(2);
const names = which.length ? which : JSON.parse(w.shape_names()).filter(n => n !== "cjk_all_resident");
for (const n of names) console.log(w.run_shape(n, n === "cjk_all_resident" ? 5 : 30));
console.log(JSON.stringify({ transform_hash_wasm: w.transform_hash() }));
for (const p of [100, 1000, 10000]) console.log(JSON.stringify({ structured_export_points: p, ms: w.export_structured_ms(p, 20) }));
