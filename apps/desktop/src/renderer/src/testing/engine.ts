import { vi } from "vitest";
import type { GlyphSnapshot, PointSnapshot } from "@shift/types";
import { asPointId, asContourId } from "@shift/types";
import { FontEngine, MockFontEngine } from "@/engine";
import { Glyphs } from "@shift/font";
import type { CommandEditingAPI } from "@/lib/commands/core/Command";

export function createMockFontEngine(): FontEngine {
  return new FontEngine(new MockFontEngine());
}

export function createMockEditing(): CommandEditingAPI {
  let pointIdCounter = 0;
  let contourIdCounter = 0;

  return {
    addPoint: vi.fn().mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    addPointToContour: vi.fn().mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    insertPointBefore: vi.fn().mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    movePoints: vi.fn().mockReturnValue([]),
    movePointTo: vi.fn(),
    setNodePositions: vi.fn(),
    setXAdvance: vi.fn(),
    translateLayer: vi.fn(),
    toggleSmooth: vi.fn(),
    removePoints: vi.fn(),
    addContour: vi.fn().mockImplementation(() => asContourId(`contour-${++contourIdCounter}`)),
    removeContour: vi.fn(),
    closeContour: vi.fn(),
    openContour: vi.fn(),
    getActiveContourId: vi.fn().mockReturnValue(asContourId("contour-0")),
    setActiveContour: vi.fn(),
    reverseContour: vi.fn(),
    restoreSnapshot: vi.fn(),
    pasteContours: vi.fn().mockReturnValue({
      success: true,
      createdPointIds: [],
      createdContourIds: [],
      error: null,
    }),
  };
}

export function getAllPoints(snapshot: GlyphSnapshot | null): PointSnapshot[] {
  if (!snapshot) return [];
  return Glyphs.getAllPoints(snapshot);
}

export function getPointCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return Glyphs.getAllPoints(snapshot).length;
}

export function getContourCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.contours.length;
}
