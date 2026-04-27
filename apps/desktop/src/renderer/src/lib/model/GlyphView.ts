import type {
  Axis,
  AxisLocation,
  Component,
  DecomposedTransform,
  GlyphGeometry,
  GlyphVariationData,
} from "@shift/types";

import { computed, type ComputedSignal, type Signal } from "../reactive";
import { interpolate, normalize } from "../interpolation/interpolate";
import type { Font } from "./Font";

/**
 * One curve segment from a glyph's contour at the current variation location.
 *
 * `points` is a flat list of x/y pairs. Length depends on `kind`:
 * - line:  [x1, y1, x2, y2]
 * - quad:  [x1, y1, cx, cy, x2, y2]
 * - cubic: [x1, y1, c1x, c1y, c2x, c2y, x2, y2]
 *
 * The flat layout means transforms apply with one loop and SVG emission is a
 * straight readout — no per-segment shape gymnastics.
 */
export type Segment = { kind: "line" | "quad" | "cubic"; points: readonly number[] };

export type ContourBlock = { closed: boolean; segments: Segment[] };

/**
 * Build a `Path2D` from one ContourBlock. Used by the canvas drawing layer
 * when it consumes `componentContours()` directly (composites in editor).
 */
export function blockToPath2D(block: ContourBlock): Path2D {
  const p = new Path2D();
  if (block.segments.length === 0) return p;
  p.moveTo(block.segments[0].points[0], block.segments[0].points[1]);
  for (const seg of block.segments) {
    switch (seg.kind) {
      case "line":
        p.lineTo(seg.points[2], seg.points[3]);
        break;
      case "quad":
        p.quadraticCurveTo(seg.points[2], seg.points[3], seg.points[4], seg.points[5]);
        break;
      case "cubic":
        p.bezierCurveTo(
          seg.points[2],
          seg.points[3],
          seg.points[4],
          seg.points[5],
          seg.points[6],
          seg.points[7],
        );
        break;
    }
  }
  if (block.closed) p.closePath();
  return p;
}

/**
 * Reactive read-only view of a glyph at the current variation location.
 *
 * Auto-tracking via signals: read `glyph.svgPath` or `glyph.advance` inside a
 * computed/effect and the consumer re-runs when the location signal moves.
 *
 * Composites recurse via `font.glyph(baseName)` at iteration time so the LRU
 * stays the single bookkeeping mechanism — no refcounts, no pinned entries.
 */
export class GlyphView {
  readonly name: string;
  readonly #geometry: GlyphGeometry;
  readonly #components: ReadonlyArray<Component>;
  readonly #font: Font;
  readonly #values: ComputedSignal<Float64Array>;
  readonly #svgPath: ComputedSignal<string>;
  readonly #advance: ComputedSignal<number>;

  constructor(
    name: string,
    geometry: GlyphGeometry,
    variationData: GlyphVariationData | null,
    components: ReadonlyArray<Component>,
    axes: Axis[],
    $location: Signal<AxisLocation>,
    font: Font,
  ) {
    this.name = name;
    this.#geometry = geometry;
    this.#components = components;
    this.#font = font;
    this.#values = computed(() =>
      variationData
        ? interpolate(variationData, normalize($location.value, axes))
        : flattenGeometry(geometry),
    );
    // Direct $location edge so the chain survives LRU eviction of any base
    // glyph this view recurses through. Without it, when a base is evicted
    // mid-session its dispose severs the only path from $location back to
    // this composite — slider scrubs would silently stop invalidating it.
    this.#svgPath = computed(() => {
      $location.value;
      return buildSvgPath(this.contours());
    });
    this.#advance = computed(() => this.#values.value[0]);
  }

  get advance(): number {
    return this.#advance.value;
  }

  get $svgPath(): Signal<string> {
    return this.#svgPath;
  }

  get $advance(): Signal<number> {
    return this.#advance;
  }

  /**
   * Root contours owned directly by this glyph at the current location.
   * Empty for pure composites.
   */
  *rootContours(): Iterable<ContourBlock> {
    const v = this.#values.value;
    let cursor = 1;
    for (const contour of this.#geometry.contours) {
      const segments = classifySegments(contour.points, contour.closed, v, cursor);
      cursor += contour.points.length * 2;
      if (segments.length > 0) yield { closed: contour.closed, segments };
    }
  }

  /**
   * Component contours, recursed through `font.glyph(baseName).contours()`
   * with the component transform applied. The caller passes a `visited` set
   * so cycle-guarding works across the whole walk; pass a fresh set when
   * called from outside `*contours()`.
   */
  *componentContours(visited: Set<string> = new Set([this.name])): Iterable<ContourBlock> {
    for (const comp of this.#components) {
      const base = this.#font.glyph(comp.baseGlyphName);
      if (!base) continue;
      const matrix = decomposedToMatrix(comp.transform);
      for (const block of base.contours(visited)) {
        yield {
          closed: block.closed,
          segments: block.segments.map((s) => transformSegment(s, matrix)),
        };
      }
    }
  }

  /**
   * Root + component contours. Used by grid and text-run consumers; the
   * canvas combines `editable.path` (mutable root) with `componentContours`
   * directly so it never goes through this method.
   */
  *contours(visited: Set<string> = new Set()): Iterable<ContourBlock> {
    if (visited.has(this.name)) return;
    visited.add(this.name);
    try {
      yield* this.rootContours();
      yield* this.componentContours(visited);
    } finally {
      visited.delete(this.name);
    }
  }

  /** Sever dependency edges so this view and its computeds can be GC'd. */
  dispose(): void {
    this.#values.dispose();
    this.#svgPath.dispose();
    this.#advance.dispose();
  }
}

function flattenGeometry(g: GlyphGeometry): Float64Array {
  let len = 1;
  for (const c of g.contours) len += c.points.length * 2;
  len += g.anchors.length * 2;
  const out = new Float64Array(len);
  out[0] = g.xAdvance;
  let i = 1;
  for (const c of g.contours) {
    for (const p of c.points) {
      out[i++] = p.x;
      out[i++] = p.y;
    }
  }
  for (const a of g.anchors) {
    out[i++] = a.x;
    out[i++] = a.y;
  }
  return out;
}

/**
 * Walk a contour's point types and emit line/quad/cubic segments with x/y
 * read from the flat values array. Mirrors the Rust `CurveSegmentIter` and
 * the JS `parseContourSegments` classifier — but without rebuilding point
 * objects, since coords come from `values` and types come from `points`.
 */
function classifySegments(
  points: GlyphGeometry["contours"][number]["points"],
  closed: boolean,
  values: Float64Array,
  cursor: number,
): Segment[] {
  const n = points.length;
  if (n < 2) return [];

  const segments: Segment[] = [];
  const limit = closed ? n : n - 1;
  let i = 0;

  const ptType = (k: number) => points[k % n].pointType;
  const x = (k: number) => values[cursor + (k % n) * 2];
  const y = (k: number) => values[cursor + (k % n) * 2 + 1];

  while (i < limit) {
    const a = ptType(i);
    const b = ptType(i + 1);

    if (a === "onCurve" && b === "onCurve") {
      segments.push({ kind: "line", points: [x(i), y(i), x(i + 1), y(i + 1)] });
      i += 1;
      continue;
    }

    if (a === "onCurve" && b === "offCurve") {
      if (i + 2 >= (closed ? i + n : n)) break;
      const c = ptType(i + 2);

      if (c === "onCurve") {
        segments.push({
          kind: "quad",
          points: [x(i), y(i), x(i + 1), y(i + 1), x(i + 2), y(i + 2)],
        });
        i += 2;
        continue;
      }

      if (c === "offCurve") {
        if (i + 3 >= (closed ? i + n : n)) break;
        segments.push({
          kind: "cubic",
          points: [x(i), y(i), x(i + 1), y(i + 1), x(i + 2), y(i + 2), x(i + 3), y(i + 3)],
        });
        i += 3;
        continue;
      }
    }

    i += 1;
  }

  return segments;
}

function buildSvgPath(blocks: Iterable<ContourBlock>): string {
  const parts: string[] = [];
  for (const { closed, segments } of blocks) {
    if (segments.length === 0) continue;
    const out: string[] = [];
    const first = segments[0];
    out.push(`M ${first.points[0]} ${first.points[1]}`);

    for (const seg of segments) {
      switch (seg.kind) {
        case "line":
          out.push(`L ${seg.points[2]} ${seg.points[3]}`);
          break;
        case "quad":
          out.push(`Q ${seg.points[2]} ${seg.points[3]} ${seg.points[4]} ${seg.points[5]}`);
          break;
        case "cubic":
          out.push(
            `C ${seg.points[2]} ${seg.points[3]} ${seg.points[4]} ${seg.points[5]} ${seg.points[6]} ${seg.points[7]}`,
          );
          break;
      }
    }

    if (closed) out.push("Z");
    parts.push(out.join(" "));
  }
  return parts.join(" ");
}

type Matrix = { xx: number; xy: number; yx: number; yy: number; dx: number; dy: number };

/**
 * Port of `shift_ir::component::DecomposedTransform::to_matrix`. Order:
 * translate to center → scale → skew → rotate → translate back → translate.
 */
function decomposedToMatrix(t: DecomposedTransform): Matrix {
  const cosR = Math.cos((t.rotation * Math.PI) / 180);
  const sinR = Math.sin((t.rotation * Math.PI) / 180);
  const tanSx = Math.tan((t.skewX * Math.PI) / 180);
  const tanSy = Math.tan((t.skewY * Math.PI) / 180);

  const xx = t.scaleX * cosR + t.scaleY * tanSx * sinR;
  const xy = t.scaleX * sinR - t.scaleY * tanSx * cosR;
  const yx = t.scaleY * -sinR + t.scaleX * tanSy * cosR;
  const yy = t.scaleY * cosR + t.scaleX * tanSy * sinR;

  const dx = t.translateX + t.tCenterX - (xx * t.tCenterX + yx * t.tCenterY);
  const dy = t.translateY + t.tCenterY - (xy * t.tCenterX + yy * t.tCenterY);

  return { xx, xy, yx, yy, dx, dy };
}

function transformSegment(seg: Segment, m: Matrix): Segment {
  const out: number[] = [];
  for (let i = 0; i < seg.points.length; i += 2) {
    const x = seg.points[i];
    const y = seg.points[i + 1];
    out.push(m.xx * x + m.yx * y + m.dx, m.xy * x + m.yy * y + m.dy);
  }
  return { kind: seg.kind, points: out };
}
