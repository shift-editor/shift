// Item 2 (wasm): what a Rust panic or stack overflow does to a live engine
// instance, and whether reset + reload from a snapshot recovers it exactly.
const w = require("./pkg/engine_spike.js");

function attempt(label, fn) {
  try {
    const r = fn();
    console.log(`${label}: returned ${JSON.stringify(r)}`);
    return true;
  } catch (e) {
    console.log(`${label}: threw ${e.constructor.name}: ${String(e.message).slice(0, 90)}`);
    return false;
  }
}

function boot() {
  const { font, layer } = JSON.parse(w.engine_fixture());
  w.engine_init(font, layer);
  return layer;
}

for (const crash of ["engine_panic_mid_edit", "engine_overflowing_boolean"]) {
  console.log(`\n=== ${crash}`);
  const layer = boot();
  w.engine_move_first_point(42);
  // The renderer keeps the last confirmed snapshot (in practice: native's state).
  const snapshot = w.engine_snapshot();
  const before = w.engine_hash();
  attempt("crash", () => w[crash]());
  const usable = attempt("next edit on same instance", () => w.engine_move_first_point(43));
  attempt("hash on same instance", () => w.engine_hash());

  // Recovery: fresh instance (wasm-bindgen --experimental-reset-state-function), reload snapshot.
  const t = performance.now();
  w.__wbg_reset_state();
  w.engine_init(snapshot, layer);
  const after = w.engine_hash();
  console.log(`recovered in ${(performance.now() - t).toFixed(1)} ms; state equal to pre-crash snapshot: ${after === before}; instance usable before reset: ${usable}`);
  attempt("edit after recovery", () => w.engine_move_first_point(44));
}
