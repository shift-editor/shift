const { Bridge } = require(process.argv[3] + "/crates/shift-bridge/index.js");
const { mkdtempSync, rmSync } = require("fs"); const { tmpdir } = require("os"); const { join } = require("path");
const dir = mkdtempSync(join(tmpdir(), "shift-echo-"));
const b = new Bridge(); b.openWorkspace(process.argv[2], join(dir, "w.sqlite"));
const g = b.getGlyphs().find(r => r.unicodes.includes(0x6C38));
const [read] = b.readLayers([g.layers[0].id]); const layerId = read.state.layerId;
const contourId = read.state.structure.contours[0].id, pointId = read.state.structure.contours[0].points[0].id;
for (const [name, intent] of [["movePoints", { kind: "movePoints", movePoints: { layerId, pointIds: [pointId], coords: [1, 1] } }], ["reverseContour", { kind: "reverseContour", reverseContour: { layerId, contourId } }]]) {
  const t = performance.now(); const r = b.apply([intent]); const ms = performance.now() - t;
  console.log(JSON.stringify({ name, applyMs: +ms.toFixed(1), nextKeys: r.next ? Object.keys(r.next).filter(k => r.next[k] != null) : [], nextGlyphs: r.next?.glyphs?.length ?? 0, layers: r.layers.length, structure: !!r.layers[0]?.structure, dependents: r.dependents.length }));
}
b.closeWorkspace(); rmSync(dir, { recursive: true, force: true });
