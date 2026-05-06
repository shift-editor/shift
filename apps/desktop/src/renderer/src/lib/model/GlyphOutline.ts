import { Bounds, type Bounds as BoundsType, type Point2D } from "@shift/geo";
import type { GlyphHandle } from "@shift/bridge";
import type { Signal } from "@/lib/signals/signal";
import { computed, type ComputedSignal } from "@/lib/signals/signal";
import type { AxisLocation } from "@/types/variation";
import type { Contour, Matrix } from "@shift/glyph-state";
import type { Glyph } from "./Glyph";

export interface GlyphOutlineContext {
  readonly variationLocation: Signal<AxisLocation>;
  glyph(handle: GlyphHandle): Glyph | null;
}

type OutlineCommand =
  | { readonly kind: "move"; readonly to: Point2D }
  | { readonly kind: "line"; readonly to: Point2D }
  | { readonly kind: "quad"; readonly control: Point2D; readonly to: Point2D }
  | {
      readonly kind: "cubic";
      readonly control1: Point2D;
      readonly control2: Point2D;
      readonly to: Point2D;
    }
  | { readonly kind: "close" };

interface OutlineData {
  readonly commands: readonly OutlineCommand[];
  readonly bounds: BoundsType | null;
}

export class GlyphOutline {
  readonly #data: ComputedSignal<OutlineData>;
  readonly #svgPath: ComputedSignal<string>;

  constructor(glyph: Glyph, context: GlyphOutlineContext) {
    this.#data = computed(() => collectGlyphOutline(glyph, context, identityMatrix(), new Set()));
    this.#svgPath = computed(() => this.#data.value.commands.map(commandToSvg).join(" "));
  }

  get path(): Path2D {
    const path = new Path2D();
    for (const command of this.#data.value.commands) {
      switch (command.kind) {
        case "move":
          path.moveTo(command.to.x, command.to.y);
          break;
        case "line":
          path.lineTo(command.to.x, command.to.y);
          break;
        case "quad":
          path.quadraticCurveTo(command.control.x, command.control.y, command.to.x, command.to.y);
          break;
        case "cubic":
          path.bezierCurveTo(
            command.control1.x,
            command.control1.y,
            command.control2.x,
            command.control2.y,
            command.to.x,
            command.to.y,
          );
          break;
        case "close":
          path.closePath();
          break;
      }
    }
    return path;
  }

  get svgPath(): string {
    return this.#svgPath.value;
  }

  get $svgPath(): Signal<string> {
    return this.#svgPath;
  }

  get bounds(): BoundsType | null {
    return this.#data.value.bounds;
  }

  /** @knipclassignore — public outline inspection API. */
  get isEmpty(): boolean {
    return this.#data.value.commands.length === 0;
  }
}

function collectGlyphOutline(
  glyph: Glyph,
  context: GlyphOutlineContext,
  matrix: Matrix,
  stack: Set<string>,
): OutlineData {
  if (stack.has(glyph.name)) return { commands: [], bounds: null };
  stack.add(glyph.name);

  const geometry = glyph.geometryAt(context.variationLocation.value);
  const commands: OutlineCommand[] = [];
  const boundsPoints: Point2D[] = [];

  for (const contour of geometry.contours) {
    appendContour(commands, boundsPoints, contour, matrix);
  }

  for (const component of geometry.components) {
    const componentGlyph = context.glyph({ name: component.baseGlyphName });
    if (!componentGlyph) continue;

    const child = collectGlyphOutline(
      componentGlyph,
      context,
      composeMatrices(matrix, component.matrix),
      stack,
    );
    commands.push(...child.commands);
    if (child.bounds) {
      boundsPoints.push(child.bounds.min, child.bounds.max);
    }
  }

  stack.delete(glyph.name);
  return { commands, bounds: Bounds.fromPoints(boundsPoints) };
}

function appendContour(
  commands: OutlineCommand[],
  boundsPoints: Point2D[],
  contour: Contour,
  matrix: Matrix,
): void {
  const segments = contour.segments();
  const first = segments[0];
  if (!first) return;

  const start = transformPoint(matrix, first.anchor1);
  commands.push({ kind: "move", to: start });
  boundsPoints.push(start);

  for (const segment of segments) {
    switch (segment.raw.type) {
      case "line": {
        const to = transformPoint(matrix, segment.raw.points.anchor2);
        commands.push({ kind: "line", to });
        boundsPoints.push(to);
        break;
      }
      case "quad": {
        const control = transformPoint(matrix, segment.raw.points.control);
        const to = transformPoint(matrix, segment.raw.points.anchor2);
        commands.push({ kind: "quad", control, to });
        boundsPoints.push(control, to);
        break;
      }
      case "cubic": {
        const control1 = transformPoint(matrix, segment.raw.points.control1);
        const control2 = transformPoint(matrix, segment.raw.points.control2);
        const to = transformPoint(matrix, segment.raw.points.anchor2);
        commands.push({ kind: "cubic", control1, control2, to });
        boundsPoints.push(control1, control2, to);
        break;
      }
    }
  }

  if (contour.closed) commands.push({ kind: "close" });
}

function commandToSvg(command: OutlineCommand): string {
  switch (command.kind) {
    case "move":
      return `M ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
    case "line":
      return `L ${formatNumber(command.to.x)} ${formatNumber(command.to.y)}`;
    case "quad":
      return [
        "Q",
        formatNumber(command.control.x),
        formatNumber(command.control.y),
        formatNumber(command.to.x),
        formatNumber(command.to.y),
      ].join(" ");
    case "cubic":
      return [
        "C",
        formatNumber(command.control1.x),
        formatNumber(command.control1.y),
        formatNumber(command.control2.x),
        formatNumber(command.control2.y),
        formatNumber(command.to.x),
        formatNumber(command.to.y),
      ].join(" ");
    case "close":
      return "Z";
  }
}

function transformPoint(matrix: Matrix, point: Point2D): Point2D {
  return {
    x: matrix.xx * point.x + matrix.yx * point.y + matrix.dx,
    y: matrix.xy * point.x + matrix.yy * point.y + matrix.dy,
  };
}

function composeMatrices(parent: Matrix, child: Matrix): Matrix {
  return {
    xx: parent.xx * child.xx + parent.yx * child.xy,
    yx: parent.xx * child.yx + parent.yx * child.yy,
    dx: parent.xx * child.dx + parent.yx * child.dy + parent.dx,
    xy: parent.xy * child.xx + parent.yy * child.xy,
    yy: parent.xy * child.yx + parent.yy * child.yy,
    dy: parent.xy * child.dx + parent.yy * child.dy + parent.dy,
  };
}

function identityMatrix(): Matrix {
  return { xx: 1, xy: 0, yx: 0, yy: 1, dx: 0, dy: 0 };
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : `${rounded}`;
}
