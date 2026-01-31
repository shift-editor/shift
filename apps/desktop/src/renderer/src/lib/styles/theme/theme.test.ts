import { describe, it, expect } from "vitest";
import { lightTheme } from "./light";
import { getCanvasStyles } from "../canvas";

describe("Theme Tokens", () => {
  describe("lightTheme", () => {
    it("should have correct name", () => {
      expect(lightTheme.name).toBe("light");
    });

    it("should have all UI color tokens", () => {
      expect(lightTheme.ui.bg.app).toBe("#ffffff");
      expect(lightTheme.ui.bg.canvas).toBe("#f8f9fa");
      expect(lightTheme.ui.bg.toolbar).toBe("#fafafa");
      expect(lightTheme.ui.bg.toolbarHover).toBe("#f0f0f0");
      expect(lightTheme.ui.bg.surface).toBe("#ffffff");
      expect(lightTheme.ui.bg.surfaceHover).toBe("#f5f5f5");
    });

    it("should have all border color tokens", () => {
      expect(lightTheme.ui.border.default).toBe("#e5e5e5");
      expect(lightTheme.ui.border.subtle).toBe("#f0f0f0");
    });

    it("should have all text color tokens", () => {
      expect(lightTheme.ui.text.primary).toBe("#171717");
      expect(lightTheme.ui.text.secondary).toBe("#525252");
      expect(lightTheme.ui.text.muted).toBe("#737373");
    });

    it("should have all canvas accent color tokens", () => {
      expect(lightTheme.canvas.pink).toBe("#F219D1");
      expect(lightTheme.canvas.purple).toBe("#6B15EC");
      expect(lightTheme.canvas.orange).toBe("#f97316");
      expect(lightTheme.canvas.green).toBe("#03D211");
      expect(lightTheme.canvas.indigo).toBe("#6366f1");
      expect(lightTheme.canvas.blue).toBe("#3b82f6");
      expect(lightTheme.canvas.cyan).toBe("#0C92F4");
      expect(lightTheme.canvas.gray).toBe("#B0B0B0");
    });
  });
});

describe("Canvas Styles", () => {
  describe("getCanvasStyles", () => {
    const styles = getCanvasStyles(lightTheme);

    it("should create handle styles for all handle types", () => {
      expect(styles.handles.first).toBeDefined();
      expect(styles.handles.corner).toBeDefined();
      expect(styles.handles.control).toBeDefined();
      expect(styles.handles.smooth).toBeDefined();
      expect(styles.handles.direction).toBeDefined();
      expect(styles.handles.last).toBeDefined();
    });

    it("should use theme pink for corner and cyan for first/last handles", () => {
      expect(styles.handles.corner.idle.strokeStyle).toBe(lightTheme.canvas.cyan);
      expect(styles.handles.first.idle.strokeStyle).toBe(lightTheme.canvas.cyan);
      expect(styles.handles.last.idle.strokeStyle).toBe(lightTheme.canvas.cyan);
    });

    it("should use theme gray for control handles", () => {
      expect(styles.handles.control.idle.strokeStyle).toBe(lightTheme.canvas.gray);
    });

    it("should use theme green for smooth handles", () => {
      expect(styles.handles.smooth.idle.strokeStyle).toBe(lightTheme.canvas.green);
    });

    it("should use theme cyan for direction handles", () => {
      expect(styles.handles.direction.idle.strokeStyle).toBe(lightTheme.canvas.cyan);
    });

    it("should create guide styles with indigo", () => {
      expect(styles.guides.strokeStyle).toBe(lightTheme.canvas.indigo);
    });

    it("should create selection rectangle styles with blue", () => {
      expect(styles.selectionRectangle.strokeStyle).toBe(lightTheme.canvas.blue);
    });

    it("should create segment hover styles with indicator color", () => {
      expect(styles.segmentHover.strokeStyle).toBe(lightTheme.canvas.indicator);
    });

    it("should have idle, hovered, and selected states for handles", () => {
      const handleTypes = ["first", "corner", "control", "smooth", "direction", "last"] as const;

      for (const type of handleTypes) {
        expect(styles.handles[type].idle).toBeDefined();
        expect(styles.handles[type].hovered).toBeDefined();
        expect(styles.handles[type].selected).toBeDefined();

        expect(styles.handles[type].idle.size).toBeGreaterThan(0);
        expect(styles.handles[type].hovered.size).toBeGreaterThanOrEqual(
          styles.handles[type].idle.size,
        );
        expect(styles.handles[type].selected.size).toBeGreaterThanOrEqual(
          styles.handles[type].hovered.size,
        );
      }
    });
  });
});

describe("Theme exports", () => {
  it("should export applyThemeToCss function", async () => {
    const { applyThemeToCss } = await import("./utils");
    expect(typeof applyThemeToCss).toBe("function");
  });

  it("should export getThemeFromCss function", async () => {
    const { getThemeFromCss } = await import("./utils");
    expect(typeof getThemeFromCss).toBe("function");
  });

  it("should export all theme tokens from index", async () => {
    const exports = await import("./index");
    expect(exports.lightTheme).toBeDefined();
    expect(exports.applyThemeToCss).toBeDefined();
    expect(exports.getThemeFromCss).toBeDefined();
  });
});
