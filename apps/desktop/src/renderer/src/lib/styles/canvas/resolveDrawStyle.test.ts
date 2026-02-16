import { describe, expect, it } from "vitest";
import { resolveDrawStyle } from "./resolveDrawStyle";

describe("resolveDrawStyle", () => {
  it("converts line width and dash pattern with converter", () => {
    const resolved = resolveDrawStyle(
      {
        lineWidth: 2,
        strokeStyle: "#111",
        fillStyle: "#222",
        antiAlias: false,
        dashPattern: [1, 3],
      },
      (px) => px * 10,
    );

    expect(resolved).toEqual({
      lineWidth: 20,
      strokeStyle: "#111",
      fillStyle: "#222",
      antiAlias: false,
      dashPattern: [10, 30],
    });
  });

  it("keeps values unchanged with identity converter", () => {
    const resolved = resolveDrawStyle(
      {
        lineWidth: 1.5,
        strokeStyle: "#abc",
        fillStyle: "transparent",
        dashPattern: [2, 4, 6],
      },
      (px) => px,
    );

    expect(resolved.lineWidth).toBe(1.5);
    expect(resolved.dashPattern).toEqual([2, 4, 6]);
  });
});
