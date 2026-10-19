// Times today's shipped edit path: Bridge.apply (shift-workspace apply →
// shift-font apply_intents → SQLite recovery write → NAPI echo), on real fonts.
const { Bridge } = require((process.env.SHIFT_ROOT ?? require("path").resolve(__dirname, "../..")) + "/crates/shift-bridge/index.js");
const { mkdtempSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { join } = require("path");

const fontPath = process.argv[2];
const iters = Number(process.argv[3] ?? 20);
const dir = mkdtempSync(join(tmpdir(), "shift-bench-"));

try {
  const bridge = new Bridge();
  let t = performance.now();
  bridge.openWorkspace(fontPath, join(dir, "working.sqlite"));
  const openMs = performance.now() - t;

  const glyphs = bridge.getGlyphs();
  // A glyph with some outline: take one from the middle that has a layer.
  const candidates = glyphs.filter((g) => g.layers.length > 0);
  let layer = null;
  for (let i = Math.floor(candidates.length / 2); i < candidates.length && !layer; i++) {
    const [read] = bridge.readLayers([candidates[i].layers[0].id]);
    if (read && read.state.structure.contours.length > 0) layer = read.state;
  }
  const points = layer.structure.contours.flatMap((c) => c.points.map((p) => p.id));

  const samples = [];
  for (let i = 0; i <= iters; i++) {
    t = performance.now();
    bridge.apply([{ kind: "movePoints", movePoints: { layerId: layer.layerId, pointIds: [points[0]], coords: [i, i] } }]);
    if (i > 0) samples.push(performance.now() - t);
  }
  const undo = [];
  for (let i = 0; i < Math.min(iters, 10); i++) {
    t = performance.now();
    bridge.undo();
    undo.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(JSON.stringify({
    font: fontPath.split("/").pop(),
    glyphs: glyphs.length,
    layerPoints: points.length,
    openMs: Math.round(openMs),
    applyMovePointMeanMs: +mean.toFixed(2),
    applyMovePointP95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(2),
    undoMeanMs: +(undo.reduce((a, b) => a + b, 0) / undo.length).toFixed(2),
    rssMb: Math.round(process.memoryUsage().rss / 1e6),
  }));
  bridge.closeWorkspace();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
