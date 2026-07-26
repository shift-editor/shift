import { packOutline, type OutlineCommand } from "@shift/glyph-codec";
import { describe, expect, it } from "vitest";
import type { PathCommand } from "@/types/graphics";
import { PackedOutlinePath } from "./PackedOutlinePath";

const commands: readonly OutlineCommand[] = [
  { kind: "move", x: 0, y: -0 },
  { kind: "line", x: 10, y: 20 },
  { kind: "quad", cx: 30, cy: 40, x: 50, y: 60 },
  { kind: "cubic", c1x: 70, c1y: 80, c2x: 90, c2y: 100, x: 110, y: 120 },
  { kind: "close" },
];

class RecordingPath {
  readonly commands: PathCommand[] = [];

  moveTo(x: number, y: number): void {
    this.commands.push({ type: "moveTo", x, y });
  }

  lineTo(x: number, y: number): void {
    this.commands.push({ type: "lineTo", x, y });
  }

  quadraticCurveTo(cp1x: number, cp1y: number, x: number, y: number): void {
    this.commands.push({ type: "quadTo", cp1x, cp1y, x, y });
  }

  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    this.commands.push({ type: "cubicTo", cp1x, cp1y, cp2x, cp2y, x, y });
  }

  closePath(): void {
    this.commands.push({ type: "close" });
  }
}

function encodedCommands(): Uint8Array {
  return packOutline(commands).toUint8Array();
}

describe("packed outline renderer outputs", () => {
  it("prints debug SVG with the same command semantics as ContourPath", () => {
    const outline = PackedOutlinePath.fromBytes(encodedCommands());

    expect(outline.svgPath).toBe("M 0 0 L 10 20 Q 30 40 50 60 C 70 80 90 100 110 120 Z");
  });

  it("constructs and memoizes Path2D only when the canvas output is read", () => {
    const recording = new RecordingPath();
    let constructions = 0;
    const outline = PackedOutlinePath.fromBytes(encodedCommands(), () => {
      constructions += 1;
      return recording as unknown as Path2D;
    });

    expect(constructions).toBe(0);
    expect(outline.path).toBe(outline.path);
    expect(constructions).toBe(1);
    expect(recording.commands.map((command) => command.type)).toEqual([
      "moveTo",
      "lineTo",
      "quadTo",
      "cubicTo",
      "close",
    ]);
  });
});
