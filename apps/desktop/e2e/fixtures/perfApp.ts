/**
 * Perf data and reporting helpers for the shared Electron E2E fixture.
 */

export { expect, loadFont, navigateToEditor, test } from "./electronApp";

/**
 * MutatorSans "S" contour data (44 points) for generating 50K-point glyphs.
 * Same data used in the engine-layer benchmarks (testing/pointMark.ts).
 */
const MUTATORSANS_S = [
  { x: 349, y: 157, pointType: "onCurve", smooth: true },
  { x: 348, y: 238, pointType: "offCurve", smooth: false },
  { x: 299, y: 293, pointType: "offCurve", smooth: false },
  { x: 217, y: 358, pointType: "onCurve", smooth: true },
  { x: 167, y: 398, pointType: "onCurve", smooth: true },
  { x: 105, y: 447, pointType: "offCurve", smooth: false },
  { x: 84, y: 494, pointType: "offCurve", smooth: false },
  { x: 84, y: 557, pointType: "onCurve", smooth: true },
  { x: 84, y: 619, pointType: "offCurve", smooth: false },
  { x: 128, y: 673, pointType: "offCurve", smooth: false },
  { x: 211, y: 673, pointType: "onCurve", smooth: true },
  { x: 219, y: 673, pointType: "onCurve", smooth: true },
  { x: 268, y: 673, pointType: "offCurve", smooth: false },
  { x: 308, y: 664, pointType: "offCurve", smooth: false },
  { x: 348, y: 640, pointType: "onCurve", smooth: false },
  { x: 365, y: 677, pointType: "onCurve", smooth: false },
  { x: 328, y: 696, pointType: "offCurve", smooth: false },
  { x: 291, y: 711, pointType: "offCurve", smooth: false },
  { x: 229, y: 711, pointType: "onCurve", smooth: true },
  { x: 222, y: 711, pointType: "onCurve", smooth: true },
  { x: 104, y: 711, pointType: "offCurve", smooth: false },
  { x: 45, y: 639, pointType: "offCurve", smooth: false },
  { x: 46, y: 544, pointType: "onCurve", smooth: true },
  { x: 47, y: 463, pointType: "offCurve", smooth: false },
  { x: 90, y: 406, pointType: "offCurve", smooth: false },
  { x: 172, y: 341, pointType: "onCurve", smooth: true },
  { x: 222, y: 301, pointType: "onCurve", smooth: true },
  { x: 293, y: 244, pointType: "offCurve", smooth: false },
  { x: 311, y: 207, pointType: "offCurve", smooth: false },
  { x: 311, y: 144, pointType: "onCurve", smooth: true },
  { x: 311, y: 82, pointType: "offCurve", smooth: false },
  { x: 267, y: 28, pointType: "offCurve", smooth: false },
  { x: 184, y: 28, pointType: "onCurve", smooth: true },
  { x: 176, y: 28, pointType: "onCurve", smooth: true },
  { x: 123.2, y: 28, pointType: "offCurve", smooth: false },
  { x: 80.35, y: 37.99, pointType: "offCurve", smooth: false },
  { x: 37, y: 64, pointType: "onCurve", smooth: false },
  { x: 20, y: 27, pointType: "onCurve", smooth: false },
  { x: 59.91, y: 6.5, pointType: "offCurve", smooth: false },
  { x: 99.44, y: -10, pointType: "offCurve", smooth: false },
  { x: 166, y: -10, pointType: "onCurve", smooth: true },
  { x: 173, y: -10, pointType: "onCurve", smooth: true },
  { x: 291, y: -10, pointType: "offCurve", smooth: false },
  { x: 350, y: 62, pointType: "offCurve", smooth: false },
] as const;

const POINTS_PER_CONTOUR = MUTATORSANS_S.length; // 44

/**
 * Generate contour data for N target points by duplicating the S contour
 * on a grid. Returns serializable data that can be passed into page.evaluate().
 */
export function generateContourData(targetPoints: number) {
  const count = Math.ceil(targetPoints / POINTS_PER_CONTOUR);
  const cols = Math.ceil(Math.sqrt(count));
  const contours = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const offsetX = col * 500;
    const offsetY = row * 800;

    const points = MUTATORSANS_S.map((p) => ({
      x: p.x + offsetX,
      y: p.y + offsetY,
      pointType: p.pointType,
      smooth: p.smooth,
    }));

    contours.push({ points, closed: true });
  }

  return contours;
}

export interface PerfResult {
  label: string;
  samples: number[];
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

/**
 * Compute percentile stats from an array of timing samples.
 */
export function computeStats(label: string, samples: number[]): PerfResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (pct: number) => sorted[Math.floor(sorted.length * pct)] ?? 0;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  return { label, samples, p50: p(0.5), p95: p(0.95), p99: p(0.99), mean };
}

/**
 * Format perf results into a readable table string for test output.
 */
export function formatPerfTable(results: PerfResult[]): string {
  const header = "| Operation | Samples | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) |";
  const separator = "|---|---|---|---|---|---|";
  const rows = results.map(
    (r) =>
      `| ${r.label} | ${r.samples.length} | ${r.p50.toFixed(2)} | ${r.p95.toFixed(2)} | ${r.p99.toFixed(2)} | ${r.mean.toFixed(2)} |`,
  );
  return [header, separator, ...rows].join("\n");
}
