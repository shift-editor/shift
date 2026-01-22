import type { ClipboardContent, ClipboardImporter, ContourContent, PointContent } from "../types";

type PathCommand = {
  type: string;
  args: number[];
};

export class SvgImporter implements ClipboardImporter {
  readonly name = "SVG";

  canImport(text: string): boolean {
    const trimmed = text.trim();
    return (
      trimmed.includes("<svg") ||
      trimmed.includes("<path") ||
      this.#looksLikePathData(trimmed)
    );
  }

  import(text: string): ClipboardContent | null {
    const trimmed = text.trim();

    const pathData = this.#extractPathData(trimmed);
    if (!pathData) return null;

    const commands = this.#parsePathCommands(pathData);
    if (commands.length === 0) return null;

    const contours = this.#commandsToContours(commands);
    if (contours.length === 0) return null;

    return { contours };
  }

  #looksLikePathData(text: string): boolean {
    return /^[MmZzLlHhVvCcSsQqTtAa0-9\s,.\-+eE]+$/.test(text) && /[MmLlCcQqSsAa]/.test(text);
  }

  #extractPathData(text: string): string | null {
    if (this.#looksLikePathData(text)) {
      return text;
    }

    const pathMatch = text.match(/d\s*=\s*["']([^"']+)["']/);
    if (pathMatch) {
      return pathMatch[1];
    }

    return null;
  }

  #parsePathCommands(pathData: string): PathCommand[] {
    const commands: PathCommand[] = [];
    const regex = /([MmZzLlHhVvCcSsQqTtAa])([^MmZzLlHhVvCcSsQqTtAa]*)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(pathData)) !== null) {
      const type = match[1];
      const argsStr = match[2].trim();
      const args = argsStr
        ? argsStr
            .replace(/,/g, " ")
            .split(/\s+/)
            .filter((s) => s.length > 0)
            .map(Number)
            .filter((n) => !isNaN(n))
        : [];
      commands.push({ type, args });
    }

    return commands;
  }

  #commandsToContours(commands: PathCommand[]): ContourContent[] {
    const contours: ContourContent[] = [];
    let currentContour: PointContent[] = [];
    let currentX = 0;
    let currentY = 0;
    let startX = 0;
    let startY = 0;
    let lastControlX = 0;
    let lastControlY = 0;

    const finishContour = (closed: boolean) => {
      if (currentContour.length > 0) {
        contours.push({ points: currentContour, closed });
        currentContour = [];
      }
    };

    const addOnCurve = (x: number, y: number, smooth = false) => {
      currentContour.push({ x, y, pointType: "onCurve", smooth });
    };

    const addOffCurve = (x: number, y: number) => {
      currentContour.push({ x, y, pointType: "offCurve", smooth: false });
    };

    for (const cmd of commands) {
      const { type, args } = cmd;
      const isRelative = type === type.toLowerCase();

      switch (type.toUpperCase()) {
        case "M": {
          finishContour(false);
          let idx = 0;
          while (idx < args.length) {
            const x = isRelative ? currentX + args[idx] : args[idx];
            const y = isRelative ? currentY + args[idx + 1] : args[idx + 1];
            if (idx === 0) {
              startX = x;
              startY = y;
            }
            if (idx === 0 || currentContour.length === 0) {
              addOnCurve(x, y);
            } else {
              addOnCurve(x, y);
            }
            currentX = x;
            currentY = y;
            idx += 2;
          }
          break;
        }

        case "L": {
          let idx = 0;
          while (idx < args.length) {
            const x = isRelative ? currentX + args[idx] : args[idx];
            const y = isRelative ? currentY + args[idx + 1] : args[idx + 1];
            addOnCurve(x, y);
            currentX = x;
            currentY = y;
            idx += 2;
          }
          break;
        }

        case "H": {
          for (const arg of args) {
            const x = isRelative ? currentX + arg : arg;
            addOnCurve(x, currentY);
            currentX = x;
          }
          break;
        }

        case "V": {
          for (const arg of args) {
            const y = isRelative ? currentY + arg : arg;
            addOnCurve(currentX, y);
            currentY = y;
          }
          break;
        }

        case "C": {
          let idx = 0;
          while (idx + 5 < args.length || idx + 5 === args.length) {
            const c1x = isRelative ? currentX + args[idx] : args[idx];
            const c1y = isRelative ? currentY + args[idx + 1] : args[idx + 1];
            const c2x = isRelative ? currentX + args[idx + 2] : args[idx + 2];
            const c2y = isRelative ? currentY + args[idx + 3] : args[idx + 3];
            const x = isRelative ? currentX + args[idx + 4] : args[idx + 4];
            const y = isRelative ? currentY + args[idx + 5] : args[idx + 5];

            addOffCurve(c1x, c1y);
            addOffCurve(c2x, c2y);
            addOnCurve(x, y, true);

            lastControlX = c2x;
            lastControlY = c2y;
            currentX = x;
            currentY = y;
            idx += 6;
          }
          break;
        }

        case "S": {
          let idx = 0;
          while (idx + 3 < args.length || idx + 3 === args.length) {
            const c1x = 2 * currentX - lastControlX;
            const c1y = 2 * currentY - lastControlY;
            const c2x = isRelative ? currentX + args[idx] : args[idx];
            const c2y = isRelative ? currentY + args[idx + 1] : args[idx + 1];
            const x = isRelative ? currentX + args[idx + 2] : args[idx + 2];
            const y = isRelative ? currentY + args[idx + 3] : args[idx + 3];

            addOffCurve(c1x, c1y);
            addOffCurve(c2x, c2y);
            addOnCurve(x, y, true);

            lastControlX = c2x;
            lastControlY = c2y;
            currentX = x;
            currentY = y;
            idx += 4;
          }
          break;
        }

        case "Q": {
          let idx = 0;
          while (idx + 3 < args.length || idx + 3 === args.length) {
            const cx = isRelative ? currentX + args[idx] : args[idx];
            const cy = isRelative ? currentY + args[idx + 1] : args[idx + 1];
            const x = isRelative ? currentX + args[idx + 2] : args[idx + 2];
            const y = isRelative ? currentY + args[idx + 3] : args[idx + 3];

            addOffCurve(cx, cy);
            addOnCurve(x, y, true);

            lastControlX = cx;
            lastControlY = cy;
            currentX = x;
            currentY = y;
            idx += 4;
          }
          break;
        }

        case "T": {
          let idx = 0;
          while (idx + 1 < args.length || idx + 1 === args.length) {
            const cx = 2 * currentX - lastControlX;
            const cy = 2 * currentY - lastControlY;
            const x = isRelative ? currentX + args[idx] : args[idx];
            const y = isRelative ? currentY + args[idx + 1] : args[idx + 1];

            addOffCurve(cx, cy);
            addOnCurve(x, y, true);

            lastControlX = cx;
            lastControlY = cy;
            currentX = x;
            currentY = y;
            idx += 2;
          }
          break;
        }

        case "Z": {
          finishContour(true);
          currentX = startX;
          currentY = startY;
          break;
        }

        case "A": {
          let idx = 0;
          while (idx + 6 < args.length || idx + 6 === args.length) {
            const x = isRelative ? currentX + args[idx + 5] : args[idx + 5];
            const y = isRelative ? currentY + args[idx + 6] : args[idx + 6];
            addOnCurve(x, y);
            currentX = x;
            currentY = y;
            idx += 7;
          }
          break;
        }
      }
    }

    finishContour(false);
    return contours;
  }
}
