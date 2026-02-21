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
      trimmed.includes("<svg") || trimmed.includes("<path") || this.#looksLikePathData(trimmed)
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
      return pathMatch.at(1) ?? null;
    }

    return null;
  }

  #parsePathCommands(pathData: string): PathCommand[] {
    const commands: PathCommand[] = [];
    const regex = /([MmZzLlHhVvCcSsQqTtAa])([^MmZzLlHhVvCcSsQqTtAa]*)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(pathData)) !== null) {
      const type = match.at(1);
      if (!type) continue;

      const argsStr = (match.at(2) ?? "").trim();
      const args = argsStr
        ? argsStr
            .replace(/,/g, " ")
            .split(/\s+/)
            .filter((s) => s.length > 0)
            .map(Number)
            .filter((n) => Number.isFinite(n))
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

    const pairAt = (values: number[], idx: number): readonly [number, number] | null => {
      const v0 = values[idx];
      const v1 = values[idx + 1];
      if (v0 === undefined || v1 === undefined) return null;
      return [v0, v1];
    };

    const quadAt = (
      values: number[],
      idx: number,
    ): readonly [number, number, number, number] | null => {
      const v0 = values[idx];
      const v1 = values[idx + 1];
      const v2 = values[idx + 2];
      const v3 = values[idx + 3];
      if (v0 === undefined || v1 === undefined || v2 === undefined || v3 === undefined) return null;
      return [v0, v1, v2, v3];
    };

    const sextetAt = (
      values: number[],
      idx: number,
    ): readonly [number, number, number, number, number, number] | null => {
      const v0 = values[idx];
      const v1 = values[idx + 1];
      const v2 = values[idx + 2];
      const v3 = values[idx + 3];
      const v4 = values[idx + 4];
      const v5 = values[idx + 5];
      if (
        v0 === undefined ||
        v1 === undefined ||
        v2 === undefined ||
        v3 === undefined ||
        v4 === undefined ||
        v5 === undefined
      ) {
        return null;
      }
      return [v0, v1, v2, v3, v4, v5];
    };

    const septetAt = (
      values: number[],
      idx: number,
    ): readonly [number, number, number, number, number, number, number] | null => {
      const v0 = values[idx];
      const v1 = values[idx + 1];
      const v2 = values[idx + 2];
      const v3 = values[idx + 3];
      const v4 = values[idx + 4];
      const v5 = values[idx + 5];
      const v6 = values[idx + 6];
      if (
        v0 === undefined ||
        v1 === undefined ||
        v2 === undefined ||
        v3 === undefined ||
        v4 === undefined ||
        v5 === undefined ||
        v6 === undefined
      ) {
        return null;
      }
      return [v0, v1, v2, v3, v4, v5, v6];
    };

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
          while (true) {
            const pair = pairAt(args, idx);
            if (!pair) break;

            const [dx, dy] = pair;
            const x = isRelative ? currentX + dx : dx;
            const y = isRelative ? currentY + dy : dy;
            if (idx === 0) {
              startX = x;
              startY = y;
            }
            addOnCurve(x, y);
            currentX = x;
            currentY = y;
            idx += 2;
          }
          break;
        }

        case "L": {
          let idx = 0;
          while (true) {
            const pair = pairAt(args, idx);
            if (!pair) break;

            const [dx, dy] = pair;
            const x = isRelative ? currentX + dx : dx;
            const y = isRelative ? currentY + dy : dy;
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
          while (true) {
            const segment = sextetAt(args, idx);
            if (!segment) break;

            const [dc1x, dc1y, dc2x, dc2y, dx, dy] = segment;
            const c1x = isRelative ? currentX + dc1x : dc1x;
            const c1y = isRelative ? currentY + dc1y : dc1y;
            const c2x = isRelative ? currentX + dc2x : dc2x;
            const c2y = isRelative ? currentY + dc2y : dc2y;
            const x = isRelative ? currentX + dx : dx;
            const y = isRelative ? currentY + dy : dy;

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
          while (true) {
            const segment = quadAt(args, idx);
            if (!segment) break;

            const c1x = 2 * currentX - lastControlX;
            const c1y = 2 * currentY - lastControlY;
            const [dc2x, dc2y, dx, dy] = segment;
            const c2x = isRelative ? currentX + dc2x : dc2x;
            const c2y = isRelative ? currentY + dc2y : dc2y;
            const x = isRelative ? currentX + dx : dx;
            const y = isRelative ? currentY + dy : dy;

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
          while (true) {
            const segment = quadAt(args, idx);
            if (!segment) break;

            const [dcx, dcy, dx, dy] = segment;
            const cx = isRelative ? currentX + dcx : dcx;
            const cy = isRelative ? currentY + dcy : dcy;
            const x = isRelative ? currentX + dx : dx;
            const y = isRelative ? currentY + dy : dy;

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
          while (true) {
            const pair = pairAt(args, idx);
            if (!pair) break;

            const cx = 2 * currentX - lastControlX;
            const cy = 2 * currentY - lastControlY;
            const [dx, dy] = pair;
            const x = isRelative ? currentX + dx : dx;
            const y = isRelative ? currentY + dy : dy;

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
          while (true) {
            const segment = septetAt(args, idx);
            if (!segment) break;

            const [, , , , , dx, dy] = segment;
            const x = isRelative ? currentX + dx : dx;
            const y = isRelative ? currentY + dy : dy;
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
