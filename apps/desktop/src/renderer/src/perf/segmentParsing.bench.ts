import { resolve } from "node:path";
import { bench, describe } from "vitest";
import { parseContourSegments, type NewPoint, type SegmentPoints } from "@shift/glyph-state";
import { contourSegmentLayout } from "@shift/wasm";
import { TestEditor } from "@/testing/TestEditor";

/**
 * Segment parsing in TypeScript against shift-font's `CurveSegmentIter` through
 * `@shift/wasm`, both producing the same segment descriptions.
 *
 * @remarks
 * The wasm path includes packing point types and unpacking the layout into
 * segment objects, so the two produce the same output.
 *
 * - **glyph** parses one glyph's contours, as a structural edit does.
 * - **font** parses every contour of every glyph, as loading the font does.
 * - **large contour** parses one 50K-point contour.
 *
 * The font defaults to `fixtures/fonts/Homenaje.glyphs`; set
 * `SHIFT_BENCH_SEGMENT_FONT` to measure another.
 */

const FONT = process.env.SHIFT_BENCH_SEGMENT_FONT ?? resolve(process.cwd(), "../../fixtures/fonts/Homenaje.glyphs");
const OPTIONS = { time: 0, iterations: 200, warmupTime: 0, warmupIterations: 20 };
const POINT_TYPE_CODES = { onCurve: 0, offCurve: 1, qCurve: 2 } as const;

interface BenchContour {
  readonly points: readonly NewPoint[];
  readonly closed: boolean;
}

async function fontContours(): Promise<BenchContour[][]> {
  const editor = await new TestEditor().openSession(FONT, "A");
  const glyphs: BenchContour[][] = [];
  for (const record of editor.font.glyphRecords()) {
    const glyph = await editor.font.loadGlyph(record.id);
    for (const layer of glyph?.layers ?? []) {
      glyphs.push(
        layer.geometry.contours.map((contour) => ({
          closed: contour.closed,
          points: contour.points.map((point) => ({
            x: point.x,
            y: point.y,
            pointType: point.pointType,
            smooth: point.smooth,
          })),
        })),
      );
    }
  }
  return glyphs.filter((contours) => contours.length > 0);
}

function parseInTypeScript(contours: readonly BenchContour[]): number {
  let segments = 0;
  for (const contour of contours) segments += parseContourSegments(contour).length;
  return segments;
}

function parseInWasm(contours: readonly BenchContour[]): number {
  let pointCount = 0;
  for (const contour of contours) pointCount += contour.points.length;

  const types = new Uint8Array(pointCount);
  const lengths = new Uint32Array(contours.length);
  const closed = new Uint8Array(contours.length);
  let offset = 0;
  for (const [index, contour] of contours.entries()) {
    lengths[index] = contour.points.length;
    closed[index] = contour.closed ? 1 : 0;
    for (const point of contour.points) types[offset++] = POINT_TYPE_CODES[point.pointType];
  }

  const layout = contourSegmentLayout(types, lengths, closed);
  let cursor = 0;
  let segments = 0;
  for (const contour of contours) {
    const count = layout[cursor++]!;
    const unpacked: SegmentPoints<NewPoint>[] = [];
    for (let segment = 0; segment < count; segment++) {
      unpacked.push(segmentAt(contour, layout[cursor++]!, layout[cursor++]!));
    }
    segments += unpacked.length;
  }
  return segments;
}

function segmentAt(contour: BenchContour, start: number, count: number): SegmentPoints<NewPoint> {
  const { points } = contour;
  const at = (offset: number) => points[(start + offset) % points.length]!;
  if (count === 2) return { type: "line", start: at(0), end: at(1) };
  if (count === 3) return { type: "quad", start: at(0), control: at(1), end: at(2) };
  return { type: "cubic", start: at(0), controlStart: at(1), controlEnd: at(2), end: at(3) };
}

function largeContour(pointCount: number): BenchContour {
  const pattern = ["onCurve", "offCurve", "offCurve"] as const;
  return {
    closed: true,
    points: Array.from({ length: pointCount }, (_, index) => ({
      x: index,
      y: index,
      pointType: pattern[index % pattern.length]!,
      smooth: false,
    })),
  };
}

const glyphs = await fontContours();
const allContours = glyphs.flat();
const typicalGlyph = glyphs.toSorted((a, b) => a.length - b.length)[Math.floor(glyphs.length / 2)]!;
const large = [largeContour(50_000)];

const totalPoints = allContours.reduce((sum, contour) => sum + contour.points.length, 0);
console.log(
  `segment bench: ${glyphs.length} layers, ${allContours.length} contours, ${totalPoints} points; ` +
    `typical glyph ${typicalGlyph.length} contours`,
);
if (parseInTypeScript(allContours) !== parseInWasm(allContours)) {
  throw new Error("TypeScript and wasm segment counts differ");
}

describe("segment parsing: glyph", () => {
  bench("typescript", () => void parseInTypeScript(typicalGlyph), OPTIONS);
  bench("wasm, one call per glyph", () => void parseInWasm(typicalGlyph), OPTIONS);
  bench(
    "wasm, one call per contour",
    () => {
      for (const contour of typicalGlyph) parseInWasm([contour]);
    },
    OPTIONS,
  );
});

describe("segment parsing: font", () => {
  bench("typescript", () => void parseInTypeScript(allContours), OPTIONS);
  bench("wasm, one call for the font", () => void parseInWasm(allContours), OPTIONS);
  bench(
    "wasm, one call per glyph",
    () => {
      for (const contours of glyphs) parseInWasm(contours);
    },
    OPTIONS,
  );
});

describe("segment parsing: large contour", () => {
  bench("typescript", () => void parseInTypeScript(large), OPTIONS);
  bench("wasm", () => void parseInWasm(large), OPTIONS);
});

const packedFont = (() => {
  const types = new Uint8Array(totalPoints);
  const lengths = new Uint32Array(allContours.length);
  const closed = new Uint8Array(allContours.length);
  let offset = 0;
  for (const [index, contour] of allContours.entries()) {
    lengths[index] = contour.points.length;
    closed[index] = contour.closed ? 1 : 0;
    for (const point of contour.points) types[offset++] = POINT_TYPE_CODES[point.pointType];
  }
  return { types, lengths, closed };
})();

describe("segment parsing: font, wasm breakdown", () => {
  bench("call only", () => void contourSegmentLayout(packedFont.types, packedFont.lengths, packedFont.closed), OPTIONS);
  bench("pack + call", () => {
    const types = new Uint8Array(totalPoints);
    let offset = 0;
    for (const contour of allContours) for (const point of contour.points) types[offset++] = POINT_TYPE_CODES[point.pointType];
    contourSegmentLayout(types, packedFont.lengths, packedFont.closed);
  }, OPTIONS);
});
