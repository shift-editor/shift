import type { IRenderer } from "@/types/graphics";

export interface SvgPathCommand {
  type: string;
  args: number[];
}

export function parseSvgPath(pathData: string): SvgPathCommand[] {
  const commands: SvgPathCommand[] = [];
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

export function renderSvgPathToCanvas(ctx: IRenderer, pathData: string): void {
  const commands = parseSvgPath(pathData);

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastControlX = 0;
  let lastControlY = 0;

  for (const cmd of commands) {
    const { type, args } = cmd;
    const isRelative = type === type.toLowerCase();

    switch (type.toUpperCase()) {
      case "M": {
        let idx = 0;
        while (idx < args.length) {
          const x = isRelative ? currentX + args[idx] : args[idx];
          const y = isRelative ? currentY + args[idx + 1] : args[idx + 1];
          if (idx === 0) {
            ctx.moveTo(x, y);
            startX = x;
            startY = y;
          } else {
            ctx.lineTo(x, y);
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
          ctx.lineTo(x, y);
          currentX = x;
          currentY = y;
          idx += 2;
        }
        break;
      }

      case "H": {
        for (const arg of args) {
          const x = isRelative ? currentX + arg : arg;
          ctx.lineTo(x, currentY);
          currentX = x;
        }
        break;
      }

      case "V": {
        for (const arg of args) {
          const y = isRelative ? currentY + arg : arg;
          ctx.lineTo(currentX, y);
          currentY = y;
        }
        break;
      }

      case "C": {
        let idx = 0;
        while (idx + 5 <= args.length) {
          const c1x = isRelative ? currentX + args[idx] : args[idx];
          const c1y = isRelative ? currentY + args[idx + 1] : args[idx + 1];
          const c2x = isRelative ? currentX + args[idx + 2] : args[idx + 2];
          const c2y = isRelative ? currentY + args[idx + 3] : args[idx + 3];
          const x = isRelative ? currentX + args[idx + 4] : args[idx + 4];
          const y = isRelative ? currentY + args[idx + 5] : args[idx + 5];

          ctx.cubicTo(c1x, c1y, c2x, c2y, x, y);

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
        while (idx + 3 <= args.length) {
          const c1x = 2 * currentX - lastControlX;
          const c1y = 2 * currentY - lastControlY;
          const c2x = isRelative ? currentX + args[idx] : args[idx];
          const c2y = isRelative ? currentY + args[idx + 1] : args[idx + 1];
          const x = isRelative ? currentX + args[idx + 2] : args[idx + 2];
          const y = isRelative ? currentY + args[idx + 3] : args[idx + 3];

          ctx.cubicTo(c1x, c1y, c2x, c2y, x, y);

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
        while (idx + 3 <= args.length) {
          const cx = isRelative ? currentX + args[idx] : args[idx];
          const cy = isRelative ? currentY + args[idx + 1] : args[idx + 1];
          const x = isRelative ? currentX + args[idx + 2] : args[idx + 2];
          const y = isRelative ? currentY + args[idx + 3] : args[idx + 3];

          ctx.quadTo(cx, cy, x, y);

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
        while (idx + 1 <= args.length) {
          const cx = 2 * currentX - lastControlX;
          const cy = 2 * currentY - lastControlY;
          const x = isRelative ? currentX + args[idx] : args[idx];
          const y = isRelative ? currentY + args[idx + 1] : args[idx + 1];

          ctx.quadTo(cx, cy, x, y);

          lastControlX = cx;
          lastControlY = cy;
          currentX = x;
          currentY = y;
          idx += 2;
        }
        break;
      }

      case "A": {
        let idx = 0;
        while (idx + 6 <= args.length) {
          const x = isRelative ? currentX + args[idx + 5] : args[idx + 5];
          const y = isRelative ? currentY + args[idx + 6] : args[idx + 6];
          ctx.lineTo(x, y);
          currentX = x;
          currentY = y;
          idx += 7;
        }
        break;
      }

      case "Z": {
        ctx.closePath();
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }
}
