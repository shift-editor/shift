import { IPath, PathCommand } from "@/types/graphics";

export class Path2D implements IPath {
  #commands: PathCommand[] = [];
  invalidated: boolean = false;

  constructor() {}

  moveTo(x: number, y: number): void {
    this.#commands.push({ type: "moveTo", x, y });
  }

  lineTo(x: number, y: number): void {
    this.#commands.push({ type: "lineTo", x, y });
  }

  cubicTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.#commands.push({ type: "cubicTo", cp1x, cp1y, cp2x, cp2y, x, y });
  }

  closePath(): void {
    this.#commands.push({ type: "close" });
  }

  get commands(): ReadonlyArray<PathCommand> {
    return this.#commands;
  }

  isEmpty(): boolean {
    return this.#commands.length === 0;
  }

  clear(): void {
    this.#commands = [];
  }
}
