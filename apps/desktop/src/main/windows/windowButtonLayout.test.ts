import { describe, expect, it } from "vitest";
import { parseButtonLayout } from "./windowButtonLayout";

describe("window buttons follow the desktop's layout", () => {
  it("places buttons after the colon at the end of the row", () => {
    expect(parseButtonLayout("appmenu:minimize,maximize,close")).toEqual({
      start: [],
      end: ["minimize", "maximize", "close"],
    });
  });

  it("places buttons before the colon at the start, in the desktop's order", () => {
    expect(parseButtonLayout("close,minimize,maximize:")).toEqual({
      start: ["close", "minimize", "maximize"],
      end: [],
    });
  });

  it("draws only the buttons the desktop asks for", () => {
    expect(parseButtonLayout("appmenu:close")).toEqual({ start: [], end: ["close"] });
  });

  it("ignores entries Shift does not draw", () => {
    expect(parseButtonLayout("icon,spacer:menu,close")).toEqual({ start: [], end: ["close"] });
  });
});
