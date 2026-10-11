import { describe, expect, it } from "vitest";
import type { GlyphId } from "@shift/types";
import { PreviewLayout } from "./PreviewLayout";

const word = (memberId: string, width: number) => ({ memberId: memberId as GlyphId, width });

describe("group preview layout", () => {
  it("wraps words into even columns and finds the member under a point", () => {
    const words = [word("A", 30), word("Aacute", 40), word("Agrave", 20)];

    const layout = PreviewLayout.of(words, 100, 10, 20);

    expect(layout.cells.map((cell) => [cell.cellX, cell.line])).toEqual([
      [0, 0],
      [50, 0],
      [0, 1],
    ]);
    expect(layout.height).toBe(40);
    expect(layout.memberAt(60, 5)).toBe("Aacute");
    expect(layout.memberAt(10, 25)).toBe("Agrave");
    expect(layout.memberAt(60, 25)).toBeNull();
  });

  it("keeps one line of height with no words", () => {
    expect(PreviewLayout.of([], 100, 10, 20).height).toBe(20);
  });
});
