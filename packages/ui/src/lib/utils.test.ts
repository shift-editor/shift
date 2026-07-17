import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("UI typography class merging", () => {
  it("preserves the UI font size alongside a text color", () => {
    expect(cn("text-ui", "text-primary")).toBe("text-ui text-primary");
  });

  it("preserves a primary foreground when the UI font size is applied later", () => {
    expect(cn("bg-accent text-white", "text-ui")).toBe("bg-accent text-white text-ui");
  });
});
