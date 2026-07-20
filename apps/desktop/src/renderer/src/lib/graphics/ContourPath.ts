import {
  Bounds,
  Curve,
  Mat,
  type Bounds as BoundsType,
  type MatModel,
  type Point2D,
} from "@shift/geo";
import type { SegmentedContour } from "@shift/glyph-state";
import type { PathCommand } from "@/types/graphics";
import { formatDecimal } from "@/lib/utils/number";

/**
 * Represents one transformed contour as reusable vector-path output.
 *
 * @remarks
 * Commands are derived eagerly because every output shares them. Tight bounds,
 * SVG text, and Canvas `Path2D` are each derived on first access, so consumers
 * pay only for the representations they observe.
 */
export class ContourPath {
  readonly commands: readonly PathCommand[];

  #bounds: BoundsType | null | undefined;
  #path: Path2D | null = null;
  #svgPath: string | null = null;

  private constructor(commands: readonly PathCommand[]) {
    this.commands = commands;
  }

  /**
   * Creates path output for a contour in its destination coordinate space.
   *
   * @param contour - Point geometry and closure state to encode.
   * @param transform - Matrix from contour coordinates into destination coordinates.
   * @returns A path value whose output representations are independently lazy.
   */
  static fromContour(contour: SegmentedContour, transform: MatModel): ContourPath {
    const segments = contour.segments();
    const first = segments[0];
    if (!first) return new ContourPath([]);

    const start = Mat.applyToPoint(transform, first.start);
    const commands: PathCommand[] = [{ type: "moveTo", x: start.x, y: start.y }];

    for (const segment of segments) {
      const points = segment.points;
      switch (points.type) {
        case "line": {
          const end = Mat.applyToPoint(transform, points.end);
          commands.push({ type: "lineTo", x: end.x, y: end.y });
          break;
        }
        case "quad": {
          const control = Mat.applyToPoint(transform, points.control);
          const end = Mat.applyToPoint(transform, points.end);
          commands.push({
            type: "quadTo",
            cp1x: control.x,
            cp1y: control.y,
            x: end.x,
            y: end.y,
          });
          break;
        }
        case "cubic": {
          const controlStart = Mat.applyToPoint(transform, points.controlStart);
          const controlEnd = Mat.applyToPoint(transform, points.controlEnd);
          const end = Mat.applyToPoint(transform, points.end);
          commands.push({
            type: "cubicTo",
            cp1x: controlStart.x,
            cp1y: controlStart.y,
            cp2x: controlEnd.x,
            cp2y: controlEnd.y,
            x: end.x,
            y: end.y,
          });
          break;
        }
      }
    }

    if (contour.closed) commands.push({ type: "close" });
    return new ContourPath(commands);
  }

  /** Returns tight curve bounds, or `null` when the contour has no segments. */
  get bounds(): BoundsType | null {
    if (this.#bounds !== undefined) return this.#bounds;

    let current: Point2D | null = null;
    const bounds: BoundsType[] = [];
    for (const command of this.commands) {
      switch (command.type) {
        case "moveTo":
          current = command;
          break;
        case "lineTo":
          if (current) bounds.push(Curve.bounds(Curve.line(current, command)));
          current = command;
          break;
        case "quadTo":
          if (current) {
            bounds.push(
              Curve.bounds(Curve.quadratic(current, { x: command.cp1x, y: command.cp1y }, command)),
            );
          }
          current = command;
          break;
        case "cubicTo":
          if (current) {
            bounds.push(
              Curve.bounds(
                Curve.cubic(
                  current,
                  { x: command.cp1x, y: command.cp1y },
                  { x: command.cp2x, y: command.cp2y },
                  command,
                ),
              ),
            );
          }
          current = command;
          break;
        case "close":
          break;
      }
    }

    this.#bounds = Bounds.unionAll(bounds);
    return this.#bounds;
  }

  /** Returns a cached Canvas path for this contour. */
  get path(): Path2D {
    if (this.#path) return this.#path;

    const path = new Path2D();
    for (const command of this.commands) {
      switch (command.type) {
        case "moveTo":
          path.moveTo(command.x, command.y);
          break;
        case "lineTo":
          path.lineTo(command.x, command.y);
          break;
        case "quadTo":
          path.quadraticCurveTo(command.cp1x, command.cp1y, command.x, command.y);
          break;
        case "cubicTo":
          path.bezierCurveTo(
            command.cp1x,
            command.cp1y,
            command.cp2x,
            command.cp2y,
            command.x,
            command.y,
          );
          break;
        case "close":
          path.closePath();
          break;
      }
    }

    this.#path = path;
    return path;
  }

  /** Returns a cached SVG path-data string for this contour. */
  get svgPath(): string {
    if (this.#svgPath !== null) return this.#svgPath;

    this.#svgPath = this.commands.map(svgCommand).join(" ");
    return this.#svgPath;
  }
}

function svgCommand(command: PathCommand): string {
  switch (command.type) {
    case "moveTo":
      return `M ${formatDecimal(command.x)} ${formatDecimal(command.y)}`;
    case "lineTo":
      return `L ${formatDecimal(command.x)} ${formatDecimal(command.y)}`;
    case "quadTo":
      return `Q ${formatDecimal(command.cp1x)} ${formatDecimal(command.cp1y)} ${formatDecimal(command.x)} ${formatDecimal(command.y)}`;
    case "cubicTo":
      return `C ${formatDecimal(command.cp1x)} ${formatDecimal(command.cp1y)} ${formatDecimal(command.cp2x)} ${formatDecimal(command.cp2y)} ${formatDecimal(command.x)} ${formatDecimal(command.y)}`;
    case "close":
      return "Z";
  }
}
