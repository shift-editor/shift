import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClipboardService } from "./ClipboardService";
import type { ClipboardServiceDeps } from "./types";

vi.stubGlobal("window", {
  electronAPI: {
    clipboardWriteText: vi.fn(),
    clipboardReadText: vi.fn().mockReturnValue(""),
  },
});

function createMockDeps(): ClipboardServiceDeps {
  return {
    getGlyph: vi.fn(() => null),
    getSelectedPointIds: vi.fn(() => []),
    getSelectedSegmentIds: vi.fn(() => []),
  };
}

describe("ClipboardService", () => {
  let service: ClipboardService;
  let deps: ClipboardServiceDeps;

  beforeEach(() => {
    deps = createMockDeps();
    service = new ClipboardService(deps);
    vi.clearAllMocks();
  });

  describe("getNextPasteOffset", () => {
    it("should return incrementing offsets", () => {
      const first = service.getNextPasteOffset();
      expect(first).toEqual({ x: 20, y: -20 });

      const second = service.getNextPasteOffset();
      expect(second).toEqual({ x: 40, y: -40 });

      const third = service.getNextPasteOffset();
      expect(third).toEqual({ x: 60, y: -60 });
    });

    it("should reset after resetPasteCount", () => {
      service.getNextPasteOffset();
      service.getNextPasteOffset();
      service.resetPasteCount();

      const offset = service.getNextPasteOffset();
      expect(offset).toEqual({ x: 20, y: -20 });
    });
  });

  describe("write", () => {
    it("should reset paste count on write", async () => {
      service.getNextPasteOffset();
      service.getNextPasteOffset();

      await service.write({ contours: [] });

      const offset = service.getNextPasteOffset();
      expect(offset).toEqual({ x: 20, y: -20 });
    });

    it("should write to system clipboard", async () => {
      const content = {
        contours: [
          {
            points: [{ x: 100, y: 100, pointType: "onCurve" as const, smooth: false }],
            closed: false,
          },
        ],
      };

      const result = await service.write(content, "A");

      expect(result).toBe(true);
      expect(window.electronAPI!.clipboardWriteText).toHaveBeenCalled();
    });
  });

  describe("read", () => {
    it("should return internal state when system clipboard empty", async () => {
      const content = {
        contours: [
          {
            points: [{ x: 50, y: 50, pointType: "onCurve" as const, smooth: false }],
            closed: false,
          },
        ],
      };
      await service.write(content);

      const state = await service.read();

      expect(state.content).toEqual(content);
    });

    it("should parse native format from system clipboard", async () => {
      const nativePayload = {
        version: 1,
        format: "shift/glyph-data",
        content: {
          contours: [
            {
              points: [{ x: 200, y: 200, pointType: "onCurve", smooth: false }],
              closed: false,
            },
          ],
        },
        metadata: {
          bounds: {
            x: 200,
            y: 200,
            width: 0,
            height: 0,
            left: 200,
            top: 200,
            right: 200,
            bottom: 200,
          },
          timestamp: Date.now(),
        },
      };

      vi.mocked(window.electronAPI!.clipboardReadText).mockReturnValue(
        JSON.stringify(nativePayload),
      );

      const state = await service.read();

      expect(state.content).toEqual(nativePayload.content);
    });
  });

  describe("resolveSelection", () => {
    it("should return null when no glyph", () => {
      const result = service.resolveSelection();
      expect(result).toBe(null);
    });

    it("should return null when no selection", () => {
      vi.mocked(deps.getGlyph).mockReturnValue({
        unicode: 65,
        name: "A",
        xAdvance: 500,
        contours: [],
        anchors: [],
        compositeContours: [],
        activeContourId: null,
      });
      vi.mocked(deps.getSelectedPointIds).mockReturnValue([]);
      vi.mocked(deps.getSelectedSegmentIds).mockReturnValue([]);

      const result = service.resolveSelection();

      expect(result).toBe(null);
    });
  });
});
