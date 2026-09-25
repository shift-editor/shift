import { describe, expect, it } from "vitest";
import { buildMarkerStyles } from "./markers/handleStyles";
import { readEditorRenderTheme } from "./Theme";

describe("editor render theme", () => {
  it("provides renderer geometry without a DOM", () => {
    const theme = readEditorRenderTheme(null);

    expect(theme.guides.widthPx).toBe(0.5);
    expect(theme.handle.corner.idle.size).toBe(6);
  });

  it("reads the active editor palette from CSS", () => {
    const style = {
      getPropertyValue: (name: string) => (name === "--editor-guides-color" ? "#123456" : ""),
    };

    const theme = readEditorRenderTheme({} as Element, style);

    expect(theme.guides.color).toBe("#123456");
  });

  it("builds GPU marker colors from the active render theme", () => {
    const theme = readEditorRenderTheme(null);
    theme.handle.corner.idle.stroke = "#ff0000";

    expect(buildMarkerStyles(theme).corner.idle.strokeColor).toEqual([1, 0, 0, 1]);
  });
});
