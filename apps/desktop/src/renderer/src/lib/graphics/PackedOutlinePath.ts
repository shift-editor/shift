import { decodeOutline, type PackedGlyphOutline } from "@shift/glyph-codec";
import { formatDecimal } from "@/lib/utils/number";
import type { Path2DFactory } from "@/types/graphics";

/**
 * Renderer-owned outputs over one validated packed outline.
 *
 * The codec remains DOM-free. This adapter independently memoizes Canvas and
 * debug-SVG representations while retaining the compact bytes as source truth.
 */
export class PackedOutlinePath {
  readonly outline: PackedGlyphOutline;

  readonly #pathFactory: Path2DFactory;
  #path: Path2D | null = null;
  #svgPath: string | null = null;

  private constructor(outline: PackedGlyphOutline, pathFactory: Path2DFactory) {
    this.outline = outline;
    this.#pathFactory = pathFactory;
  }

  /** Validates transport bytes before any renderer object is created. */
  static fromBytes(
    data: Uint8Array,
    pathFactory: Path2DFactory = () => new Path2D(),
  ): PackedOutlinePath {
    return new PackedOutlinePath(decodeOutline(data), pathFactory);
  }

  /** Returns one memoized Canvas path built by replaying validated commands. */
  get path(): Path2D {
    if (this.#path) return this.#path;

    const path = this.#pathFactory();
    for (const command of this.outline) {
      switch (command.kind) {
        case "move":
          path.moveTo(command.x, command.y);
          break;
        case "line":
          path.lineTo(command.x, command.y);
          break;
        case "quad":
          path.quadraticCurveTo(command.cx, command.cy, command.x, command.y);
          break;
        case "cubic":
          path.bezierCurveTo(
            command.c1x,
            command.c1y,
            command.c2x,
            command.c2y,
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

  /** Returns memoized SVG path data for debugging and parity checks. */
  get svgPath(): string {
    if (this.#svgPath !== null) return this.#svgPath;

    const parts: string[] = [];
    for (const command of this.outline) {
      switch (command.kind) {
        case "move":
          parts.push(`M ${formatDecimal(command.x)} ${formatDecimal(command.y)}`);
          break;
        case "line":
          parts.push(`L ${formatDecimal(command.x)} ${formatDecimal(command.y)}`);
          break;
        case "quad":
          parts.push(
            `Q ${formatDecimal(command.cx)} ${formatDecimal(command.cy)} ${formatDecimal(command.x)} ${formatDecimal(command.y)}`,
          );
          break;
        case "cubic":
          parts.push(
            `C ${formatDecimal(command.c1x)} ${formatDecimal(command.c1y)} ${formatDecimal(command.c2x)} ${formatDecimal(command.c2y)} ${formatDecimal(command.x)} ${formatDecimal(command.y)}`,
          );
          break;
        case "close":
          parts.push("Z");
          break;
      }
    }

    this.#svgPath = parts.join(" ");
    return this.#svgPath;
  }
}
